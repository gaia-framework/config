import 'reflect-metadata';
import { Container } from 'inversify';
import { ConfigReader, ConfigService } from '@gaia-framework/config';

const container = new Container();
container.bind(ConfigReader).toConstantValue(new ConfigReader({ port: 4001 }));
container
  .bind(ConfigService)
  .toDynamicValue((context) => new ConfigService(context.get(ConfigReader)));

console.log(JSON.stringify({ port: container.get(ConfigService).getNumber('port') }));
