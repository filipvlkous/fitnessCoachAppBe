import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { parseStringPromise } from 'xml2js';

export interface FeedCache {
  byCategory: Record<string, object[]>;
  byManufacturer: Record<string, object[]>;
}

let feedCache: FeedCache | null = null;

@Injectable()
export class FeedService implements OnModuleInit {
  async onModuleInit() {
    await this.getCache();
  }
  getLocalCache() {
    return feedCache;
  }

  @Cron('0 5 * * *')
  async getCache(): Promise<FeedCache> {
    feedCache = null;

    const url =
      'https://feeds.mergado.com/dafit-cz-heureka-cz-produktovy-cz-1-a26875ee3aafd1f76ad99b7b03edb268.xml';

    const response = await fetch(url);
    const data = await response.text();

    const result = await parseStringPromise(data, {
      explicitArray: false,
      ignoreAttrs: true,
    });

    const rawItems = result.SHOP.SHOPITEM;
    const shopItems = Array.isArray(rawItems) ? rawItems : [rawItems];

    const byCategory: Record<string, object[]> = {};
    const byManufacturer: Record<string, object[]> = {};

    for (const item of shopItems) {
      const categoryText: string = item.CATEGORYTEXT ?? '';
      const category = categoryText.split('|').pop()?.trim() ?? 'Uncategorized';
      const manufacturer: string = item.MANUFACTURER ?? 'Unknown';

      const mapped = {
        id: item.ITEM_ID,
        code: item.PRODUCTNO,
        name: item.PRODUCTNAME,
        description: item.DESCRIPTION,
        url: item.URL,
        price: item.PRICE_VAT,
        manufacturer,
        image: item.IMGURL,
        itemType: item.ITEM_TYPE,
      };

      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push(mapped);

      if (!byManufacturer[manufacturer]) byManufacturer[manufacturer] = [];
      byManufacturer[manufacturer].push(mapped);
    }

    feedCache = { byCategory, byManufacturer };
    return feedCache;
  }

  async getAllByCategory() {
    let cache;
    if (this.getLocalCache() === null) {
      cache = await this.getCache();
    } else {
      cache = this.getLocalCache();
    }
    return cache.byCategory;
  }

  async getByCategory(category: string) {
    let cache;
    if (this.getLocalCache() === null) {
      cache = await this.getCache();
    } else {
      cache = this.getLocalCache();
    }
    const key = Object.keys(cache.byCategory).find(
      (k) => k.toLowerCase() === category.toLowerCase(),
    );
    if (!key) throw new NotFoundException(`Category '${category}' not found`);
    return cache.byCategory[key];
  }

  async getAllByManufacturer() {
    let cache;
    if (this.getLocalCache() === null) {
      cache = await this.getCache();
    } else {
      cache = this.getLocalCache();
    }
    return cache.byManufacturer;
  }

  async getByManufacturer(manufacturer: string) {
    let cache;
    if (this.getLocalCache() === null) {
      cache = await this.getCache();
    } else {
      cache = this.getLocalCache();
    }
    const key = Object.keys(cache.byManufacturer).find(
      (k) => k.toLowerCase() === manufacturer.toLowerCase(),
    );
    if (!key)
      throw new NotFoundException(`Manufacturer '${manufacturer}' not found`);
    return cache.byManufacturer[key];
  }
}