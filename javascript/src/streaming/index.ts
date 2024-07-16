// Copyright (c) 2024 Baidu, Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {ReadableStream} from 'web-streams-polyfill';

type Bytes = string | Uint8Array | null | undefined;
const EVENT_TYPE = [null, 'pluginMeta', 'plugin', 'chat'];

export type ServerSentEvent = {
    event: string | null;
    data: string;
    raw: string[];
};

class SSEDecoder {
    private data: string[];
    private event: string | null;
    private chunks: string[];

    constructor() {
        this.event = null;
        this.data = [];
        this.chunks = [];
    }

    decode(line: string) {
        if (line.endsWith('\r')) {
            line = line.substring(0, line.length - 1);
        }

        if (!line) {
            if (!this.event && !this.data.length) {
                return null;
            }

            const sse: ServerSentEvent = {
                event: this.event,
                data: this.data.join('\n'),
                raw: this.chunks,
            };

            this.event = null;
            this.data = [];
            this.chunks = [];

            return sse;
        }

        this.chunks.push(line);

        if (line.startsWith(':')) {
            return null;
        }

        let [fieldname, , value] = partition(line, ':');

        if (value.startsWith(' ')) {
            value = value.substring(1);
        }

        if (fieldname === 'event') {
            this.event = value;
        }
        else if (fieldname === 'data') {
            this.data.push(value);
        }

        return null;
    }
}

class LineDecoder {
    static NEWLINE_CHARS = new Set(['\n', '\r']);
    static NEWLINE_REGEXP = /\r\n|[\n\r]/g;

    buffer: string[];
    textDecoder: TextDecoder;

    constructor() {
        this.buffer = [];
        this.textDecoder = new TextDecoder('utf-8');
    }

    decode(chunk: Bytes): string[] {
        let text = this.decodeText(chunk);
        if (!text) {
            return [];
        }

        const trailingNewline = text.endsWith('\n') || text.endsWith('\r');
        let lines = text.split(LineDecoder.NEWLINE_REGEXP);

        if (lines.length === 1 && !trailingNewline) {
            this.buffer.push(lines[0]);
            return [];
        }
        if (this.buffer.length > 0) {
            lines = [this.buffer.join('') + lines[0], ...lines.slice(1)];
            this.buffer = [];
        }

        if (!trailingNewline) {
            this.buffer = [lines.pop() || ''];
        }

        return lines;
    }

    decodeText(bytes: Bytes): string {
        if (bytes == null) {
            return '';
        }
        if (typeof bytes === 'string') {
            return bytes;
        }

        if (bytes instanceof Uint8Array) {
            return this.textDecoder.decode(bytes);
        }

        throw new Error('Unsupported type for bytes input');
    }

    flush(): string[] {
        if (!this.buffer.length) {
            return [];
        }

        const lines = [this.buffer.join('')];
        this.buffer = [];
        return lines;
    }
}

export class Stream<Item> implements AsyncIterable<Item> {
    controller: AbortController;

    constructor(
        private iterator: () => AsyncIterator<Item>,
        controller: AbortController
    ) {
        this.controller = controller;
    }

    static fromSSEResponse<Item>(response: any, controller: AbortController) {
        let consumed = false;
        const decoder = new SSEDecoder();

        async function* iterMessages(): AsyncGenerator<ServerSentEvent, void, unknown> {
            if (!response.body) {
                controller.abort();
                throw new Error('Attempted to iterate over a response with no body');
            }

            const lineDecoder = new LineDecoder();
            let buffer = new Uint8Array(); // 初始化缓存的 Buffer
            let previousChunkLastByte: number | null = null;
            const iter = readableStreamAsyncIterable<Bytes>(response.body);

            for await (const chunk of iter) {
                if (chunk[0] === 10) {
                    continue;
                }
                if (previousChunkLastByte === 10) {
                    buffer = concatUint8Arrays(buffer, chunk as Uint8Array);

                    for (const line of lineDecoder.decode(buffer)) {
                        const sse = decoder.decode(line);
                        if (sse) {
                            yield sse;
                        }
                    }

                    buffer = new Uint8Array();
                }
                else {
                    buffer = concatUint8Arrays(buffer, chunk as Uint8Array);
                }
                // 保存当前 chunk 的最后一个字节
                previousChunkLastByte = chunk[chunk.length - 1] as number; ;
            }

            for (const line of lineDecoder.flush()) {
                const sse = decoder.decode(line);
                if (sse) {
                    yield sse;
                }
            }
        }

        async function* iterator(): AsyncIterator<Item, any, undefined> {
            if (consumed) {
                throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
            }
            consumed = true;
            let done = false;
            try {
                for await (const sse of iterMessages()) {
                    if (done) {
                        continue;
                    }

                    if (sse.data.startsWith('[DONE]')) {
                        done = true;
                        continue;
                    }

                    if (EVENT_TYPE.includes(sse.event)) {
                        let data;
                        try {
                            data = JSON.parse(sse.data);
                        }
                        catch (e) {
                            console.error('Could not parse message into JSON:', sse.data);
                            console.error('From chunk:', sse.raw);
                            throw e;
                        }

                        if (data && data.error) {
                            throw new Error(data.error);
                        }

                        yield data;
                    }
                }
                done = true;
            }
            catch (e) {
                if (e instanceof Error && e.name === 'AbortError') {
                    return;
                }
                throw e;
            }
            finally {
                if (!done) {
                    controller.abort();
                }
            }
        }

        return new Stream(iterator, controller);
    }

    static fromReadableStream<Item>(readableStream: ReadableStream, controller: AbortController) {
        let consumed = false;

        async function* iterLines(): AsyncGenerator<string, void, unknown> {
            const lineDecoder = new LineDecoder();

            const iter = readableStreamAsyncIterable<Bytes>(readableStream);

            for await (const chunk of iter) {
                for (const line of lineDecoder.decode(chunk)) {
                    yield line;
                }
            }

            for (const line of lineDecoder.flush()) {
                yield line;
            }
        }

        async function* iterator(): AsyncIterator<Item, any, undefined> {
            if (consumed) {
                throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
            }
            consumed = true;
            let done = false;
            try {
                for await (const line of iterLines()) {
                    if (done) {
                        continue;
                    }
                    if (line) {
                        yield JSON.parse(line);
                    }
                }
                done = true;
            }
            catch (e) {
                if (e instanceof Error && e.name === 'AbortError') {
                    return;
                }
                throw e;
            }
            finally {
                if (!done) {
                    controller.abort();
                }
            }
        }

        return new Stream(iterator, controller);
    }

    [Symbol.asyncIterator](): AsyncIterator<Item> {
        return this.iterator();
    }

    tee(): [Stream<Item>, Stream<Item>] {
        const left: Array<Promise<IteratorResult<Item>>> = [];
        const right: Array<Promise<IteratorResult<Item>>> = [];
        const iterator = this.iterator();

        const teeIterator = (queue: Array<Promise<IteratorResult<Item>>>): AsyncIterator<Item> => {
            return {
                next: () => {
                    if (queue.length === 0) {
                        const result = iterator.next();
                        left.push(result);
                        right.push(result);
                    }
                    return queue.shift()!;
                },
            };
        };

        return [
            new Stream(() => teeIterator(left), this.controller),
            new Stream(() => teeIterator(right), this.controller),
        ];
    }

    toReadableStream(): ReadableStream {
        const self = this;
        let iter: AsyncIterator<Item>;
        const encoder = new TextEncoder();

        return new ReadableStream({
            async start() {
                iter = self[Symbol.asyncIterator]();
            },
            async pull(ctrl: any) {
                try {
                    const {value, done} = await iter.next();
                    if (done) {
                        return ctrl.close();
                    }

                    const bytes = encoder.encode(JSON.stringify(value) + '\n');
                    ctrl.enqueue(bytes);
                }
                catch (err) {
                    ctrl.error(err);
                }
            },
            async cancel() {
                await iter.return?.();
            },
        });
    }
}

function partition(str: string, delimiter: string): [string, string, string] {
    const index = str.indexOf(delimiter);
    if (index !== -1) {
        return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
    }

    return [str, '', ''];
}

// 合并两个 Uint8Array
function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

/**
 * 大多数浏览器尚未对 ReadableStream 提供异步可迭代支持，
 * 并且 Node.js 有一种非常不同的方式来从其 "ReadableStream" 中读取字节。
 *
 * 这个 polyfill 是从 https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490 拉取的。
 */
export function readableStreamAsyncIterable<T>(stream: any): AsyncIterableIterator<T> {
    if (stream[Symbol.asyncIterator]) {
        return stream;
    }

    const reader = stream.getReader();
    return {
        async next() {
            try {
                const result = await reader.read();
                if (result?.done) {
                    reader.releaseLock();
                }
                return result;
            }
            catch (e) {
                reader.releaseLock();
                throw e;
            }
        },
        async return() {
            const cancelPromise = reader.cancel();
            reader.releaseLock();
            await cancelPromise;
            return {done: true, value: undefined};
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}
