# CICOR Flow Technologies Project Tracker

## Storage Architecture

The browser talks to a storage API rather than connecting directly to MySQL. This keeps credentials server-side and makes the current local provider replaceable with the organization cloud database later.

- Local development uses the Vite shared-state provider and browser `localStorage` fallback.
- Future deployment should set `VITE_STORAGE_PROVIDER=organization-api` and point `VITE_STORAGE_API_BASE_URL` at an authenticated backend.
- The backend should use the organization ID from authentication or a trusted server session, not a user-supplied value alone.
- MySQL foundation tables are defined in [database/mysql-schema.sql](database/mysql-schema.sql). The schema covers the current application state: orders, attachments, product lines, milestones, materials/GRN data, baseline revisions and change rows, product catalog, category templates, rectification actions, audit logs, users, and organization configuration. Every business table is organization-scoped for tenant isolation.
- Copy `.env.example` to `.env.local` for local configuration. Never expose `MYSQL_PASSWORD` or other backend secrets through `VITE_` variables.

The intended production flow is:

`React app -> authenticated organization API -> MySQL`

The current development flow is:

`React app -> Vite shared-state API -> user-level JSON state file`

The schema is ready for MySQL 8/InnoDB. The remaining deployment step is an authenticated backend adapter that maps the storage contract to these tables and applies organization authorization inside transactions.

## Development

Run `npm install`, then `npm run dev`.

The rest of this document is the standard Vite starter reference.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
# Circor_tracker
