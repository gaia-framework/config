# Validation and dependency injection

## Zod

Install Zod in the application that supplies the schema:

```sh
yarn add zod
```

The library does not install or import Zod at runtime. Its exported
`ConfigSchema<T>` interface accepts synchronous `safeParse` implementations;
Zod is one compatible choice. Loading, readers and DI also work without a schema
or a Zod installation. The repository installs Zod as a development dependency
for its tests, examples and benchmarks.

```js
import { z } from 'zod';
import { loadConfigLayersFromFiles, loadConfigObjectFromFiles } from '@gaia-framework/config';

const options = {
  argv: [],
  schema: z.object({
    port: z.coerce.number().int().positive(),
    enabled: z.boolean().default(true)
  })
};
const raw = loadConfigLayersFromFiles(options); // never runs schema
const settings = loadConfigObjectFromFiles(options); // defaults/transforms applied
```

The schema is supplied by the application. Unknown-key stripping, passthrough,
refinements and transforms follow that schema. Absent schema means absent schema
validation, not implicit product defaults. The library uses synchronous
`safeParse`; asynchronous schemas are not supported by this synchronous pipeline.

`createConfig(object, schema)` and `createConfigService(object, schema)` use the
same validation. Passing an existing `ConfigReader` to `createConfigService`
reuses it and does not revalidate, even when a schema argument is supplied.

## Inversify

```js
import 'reflect-metadata';
import { Container } from 'inversify';
import { ConfigReader, ConfigService } from '@gaia-framework/config';

const container = new Container();
container.bind(ConfigReader).toConstantValue(new ConfigReader({ port: 4001 }));
container.bind(ConfigService).toDynamicValue(context =>
  new ConfigService(context.get(ConfigReader))
);
console.log(container.get(ConfigService).getNumber('port'));
```

This explicit factory binding matches the library's construction boundary and
does not assume automatic constructor-token inference. `ConfigService` retains
`@injectable()` and the build retains `experimentalDecorators` and
`emitDecoratorMetadata`. Applications using their own decorators should retain
their corresponding TypeScript settings and metadata initialization.

Use the compiled package for production. Source development imports need a
TypeScript loader (`node --import=tsx --conditions=development ...`). A loader
need not reproduce all emitted decorator metadata; packaged DI acceptance runs
against the compiled output as well as ordinary explicit construction.
