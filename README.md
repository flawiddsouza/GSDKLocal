# GSDK Local

#### Migrations

Generate migrations from schema.ts

```sh
npx drizzle-kit generate --name your_migration_name
```

Run generated migrations (not required as server will auto run migrations on startup)

```sh
npx drizzle-kit migrate
```

Check database data

```sh
npx drizzle-kit studio
```
