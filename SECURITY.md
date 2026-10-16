# Security policy

## Reporting a vulnerability

Email **contact@gaiaframework.com** to report a suspected security vulnerability
privately. Please do not disclose vulnerabilities in public issues or pull
requests before coordinated disclosure.

Include the affected version or commit, Node.js version, a minimal reproduction
using synthetic configuration, and the expected impact. Do not send real tokens,
credentials, private configuration files or personal data.

We will review the report and coordinate any fix and disclosure with you.

## Supported versions

Security fixes target `main` and are published in the latest package release.
Update to the latest version; older versions do not have separate maintenance
branches.

## Configuration trust

Configuration files and schemas are trusted application inputs. File directives
can read files accessible to the application process. Do not load untrusted
configuration with privileges or filesystem access you would not give its author.
Use `safeErrors: true` when errors may cross a trust boundary. See
[loading](docs/loading.md), [directives](docs/directives.md) and
[validation and dependency injection](docs/validation-and-di.md) for usage details.
