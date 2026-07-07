import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { parseStringPromise } from 'xml2js';

export interface FeedCache {
  byCategory: Record<string, object[]>;
  byManufacturer: Record<string, object[]>;
}

const FEED_URL =
  'https://feeds.mergado.com/dafit-cz-heureka-cz-produktovy-cz-1-a26875ee3aafd1f76ad99b7b03edb268.xml';

let feedCache: FeedCache | null = null;

@Injectable()
export class FeedService implements OnModuleInit {
  private readonly logger = new Logger(FeedService.name);

  // A feed outage must not prevent the app from booting.
  async onModuleInit() {
    try {
      await this.refreshCache();
    } catch (err: any) {
      this.logger.error(`Initial feed load failed: ${err.message}`);
    }
  }

  getLocalCache() {
    return feedCache;
  }

  @Cron('0 5 * * *')
  async refreshCacheJob() {
    try {
      await this.refreshCache();
    } catch (err: any) {
      // Keep serving the previous cache on a failed refresh.
      this.logger.error(`Feed refresh failed: ${err.message}`);
    }
  }

  async refreshCache(): Promise<FeedCache> {
    const response = await fetch(FEED_URL);
    if (!response.ok) {
      throw new Error(`Feed fetch failed with status ${response.status}`);
    }
    const data = await response.text();

    const result = await parseStringPromise(data, {
      explicitArray: false,
      ignoreAttrs: true,
    });

    const byCategory: Record<string, object[]> = {};
    const byManufacturer: Record<string, object[]> = {};

    const rawItems = result?.SHOP?.SHOPITEM;
    const shopItems = rawItems
      ? Array.isArray(rawItems)
        ? rawItems
        : [rawItems]
      : [];

    for (const item of shopItems) {
      const categoryText: string = item.CATEGORYTEXT ?? '';
      const category = categoryText.split('|').pop()?.trim() || 'Uncategorized';
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

    // Swap in the new cache only after a fully successful parse.
    feedCache = { byCategory, byManufacturer };
    return feedCache;
  }

  private async getCacheOrLoad(): Promise<FeedCache> {
    if (feedCache) return feedCache;
    try {
      return await this.refreshCache();
    } catch (err: any) {
      this.logger.error(`Feed load failed: ${err.message}`);
      throw new ServiceUnavailableException(
        'Product feed is temporarily unavailable',
      );
    }
  }

  async getAllByCategory() {
    const cache = await this.getCacheOrLoad();
    return cache.byCategory;
  }

  async getByCategory(category: string) {
    const cache = await this.getCacheOrLoad();
    const key = Object.keys(cache.byCategory).find(
      (k) => k.toLowerCase() === category.toLowerCase(),
    );
    if (!key) throw new NotFoundException(`Category '${category}' not found`);
    return cache.byCategory[key];
  }

  async getAllByManufacturer() {
    const cache = await this.getCacheOrLoad();
    return cache.byManufacturer;
  }

  async getByManufacturer(manufacturer: string) {
    const cache = await this.getCacheOrLoad();
    const key = Object.keys(cache.byManufacturer).find(
      (k) => k.toLowerCase() === manufacturer.toLowerCase(),
    );
    if (!key)
      throw new NotFoundException(`Manufacturer '${manufacturer}' not found`);
    return cache.byManufacturer[key];
  }
}
