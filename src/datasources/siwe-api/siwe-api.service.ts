import { toSignableSiweMessage } from '@/datasources/siwe-api/utils/to-signable-siwe-message';
import { SiweMessage } from '@/domain/siwe/entities/siwe-message.entity';
import { ISiweApi } from '@/domain/interfaces/siwe-api.interface';
import { LoggingService, ILoggingService } from '@/logging/logging.interface';
import { Inject, Injectable } from '@nestjs/common';
import { verifyMessage } from 'viem';
import { IConfigurationService } from '@/config/configuration.service.interface';
import {
  CacheService,
  ICacheService,
} from '@/datasources/cache/cache.service.interface';
import { CacheRouter } from '@/datasources/cache/cache.router';

@Injectable()
export class SiweApi implements ISiweApi {
  /**
   * The official SiWe implementation uses a nonce length of 17:
   *
   * > 96 bits has been chosen as a number to sufficiently balance size and security
   * > considerations relative to the lifespan of it's usage.
   *
   * ```
   * const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
   * const length = Math.ceil(96 / (Math.log(ALPHANUMERIC.length) / Math.LN2)) // 17
   * ```
   *
   * @see https://github.com/spruceid/siwe/blob/0e63b05cd3c722abd282dd1128aa8878648a8620/packages/siwe/lib/utils.ts#L36-L53
   * @see https://github.com/StableLib/stablelib/blob/5243520e343c217b6a751464dec1bc980cb510d8/packages/random/random.ts#L80-L99
   *
   * As we rely on typed arrays to generate random values, we must use an even number.
   * We therefore use a length of 18 to be compatible and remain as similar as possible.
   */
  private static readonly NONCE_LENGTH = 18;

  private readonly nonceTtlInSeconds: number;

  constructor(
    @Inject(LoggingService)
    private readonly loggingService: ILoggingService,
    @Inject(IConfigurationService)
    private readonly configurationService: IConfigurationService,
    @Inject(CacheService) private readonly cacheService: ICacheService,
  ) {
    this.nonceTtlInSeconds = this.configurationService.getOrThrow(
      'auth.nonceTtlSeconds',
    );
  }

  /**
   * Returns a string-based nonce of at least 8 alphanumeric characters
   * according to the EIP-4361 (SiWe) standard.
   *
   * @see https://eips.ethereum.org/EIPS/eip-4361#message-fields
   */
  generateNonce(): string {
    // One byte is two hex chars
    const length = SiweApi.NONCE_LENGTH / 2;
    const randomValues = crypto.getRandomValues(new Uint8Array(length));

    return Array.from(randomValues, (byte) => {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  async verifyMessage(args: {
    message: SiweMessage;
    signature: `0x${string}`;
  }): Promise<boolean> {
    const message = toSignableSiweMessage(args.message);
    try {
      return await verifyMessage({
        address: args.message.address,
        message,
        signature: args.signature,
      });
    } catch (e) {
      this.loggingService.debug(
        `Failed to verify SiWe message. message=${message}, error=${e}`,
      );
      return false;
    }
  }

  async storeNonce(nonce: string): Promise<void> {
    const cacheDir = CacheRouter.getAuthNonceCacheDir(nonce);
    await this.cacheService.set(cacheDir, nonce, this.nonceTtlInSeconds);
  }

  async getNonce(nonce: string): Promise<string | undefined> {
    const cacheDir = CacheRouter.getAuthNonceCacheDir(nonce);
    return this.cacheService.get(cacheDir);
  }

  async clearNonce(nonce: string): Promise<void> {
    const cacheDir = CacheRouter.getAuthNonceCacheDir(nonce);
    await this.cacheService.deleteByKey(cacheDir.key);
  }
}
