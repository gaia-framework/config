import { expect } from 'chai';
import { z } from 'zod';
import { createConfigService } from '../../src/index.js';

describe('config', () => {
  it('creates an in-memory ConfigService for unit tests', () => {
    const service = createConfigService(
      { http: { port: 4001 }, feature: { enabled: true } },
      z.object({
        http: z.object({ port: z.number() }),
        feature: z.object({ enabled: z.boolean() })
      })
    );

    expect(service.getNumber('http.port')).to.equal(4001);
    expect(service.getBoolean('feature.enabled')).to.equal(true);
  });
});
