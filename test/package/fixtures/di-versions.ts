import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Container } from 'inversify';
import { ConfigReader, ConfigService, createConfigService } from '@gaia-framework/config';

const service = createConfigService({ http: { port: 4100 }, enabled: true });
const token = Symbol('ConfigService');
const container = new Container();
container.bind<ConfigService>(token).toConstantValue(service);
container.bind(ConfigService).toConstantValue(service);
assert.equal(container.get<ConfigService>(token), service);
assert.equal(container.get(ConfigService), service);
assert.equal(container.get<ConfigService>(token).getNumber('http.port'), 4100);

container.bind(ConfigReader).toConstantValue(new ConfigReader({ port: 4200 }));
const factoryToken = Symbol('FactoryConfigService');
container
  .bind<ConfigService>(factoryToken)
  .toDynamicValue(() => new ConfigService(container.get(ConfigReader)));
assert.equal(container.get<ConfigService>(factoryToken).getNumber('port'), 4200);
