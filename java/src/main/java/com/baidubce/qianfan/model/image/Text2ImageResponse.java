/*
 * Copyright (c) 2024 Baidu, Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.baidubce.qianfan.model.image;

import java.util.List;

public class Text2ImageResponse {
    /**
     * 请求的Id
     */
    private String id;

    /**
     * 回包类型。例如："image" 表示图像生成返回
     */
    private String object;

    /**
     * 时间戳
     */
    private long created;

    /**
     * 生成图片结果
     */
    private List<ImageData> data;

    /**
     * token统计信息
     */
    private ImageUsage usage;

    public String getId() {
        return id;
    }

    public Text2ImageResponse setId(String id) {
        this.id = id;
        return this;
    }

    public String getObject() {
        return object;
    }

    public Text2ImageResponse setObject(String object) {
        this.object = object;
        return this;
    }

    public long getCreated() {
        return created;
    }

    public Text2ImageResponse setCreated(long created) {
        this.created = created;
        return this;
    }

    public List<ImageData> getData() {
        return data;
    }

    public Text2ImageResponse setData(List<ImageData> data) {
        this.data = data;
        return this;
    }

    public ImageUsage getUsage() {
        return usage;
    }

    public Text2ImageResponse setUsage(ImageUsage usage) {
        this.usage = usage;
        return this;
    }
}