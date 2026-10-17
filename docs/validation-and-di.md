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

The library has no runtime dependency on Inversify or `reflect-metadata`.
Install them in an application that uses this integration:

```sh
yarn add inversify reflect-metadata
```

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

`ConfigService` is an ordinary class. Register an existing service with
`toConstantValue`, or use the explicit factory above. These patterns are tested
with consumer-owned Inversify 6, 7 and 8. Applications using their own decorators
should retain their corresponding TypeScript settings and metadata initialization;
configuration loading itself requires neither.

### Migrating from 0.2

Version 0.3 removes the service's Inversify decorator and constructor metadata.
Replace `container.bind(ConfigService).toSelf()` with an explicit factory as above,
or register the service returned by `createConfigServiceFromFiles`:

```js
container.bind(ConfigService).toConstantValue(configService);
```

Existing class and symbol identifiers, factory signatures, getters and cached
service identities are unchanged. Keep application schemas and container bindings
in the application. No optional adapter or container-specific package export is
required for explicit registration.

Use the compiled package for production. Source development imports need a
TypeScript loader (`node --import=tsx --conditions=development ...`). A loader
need not emit decorator metadata for this library. Packed consumer acceptance
covers compiled output and source development imports both without a container
and with independently installed Inversify versions.
