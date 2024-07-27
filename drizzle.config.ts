import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './data/store.db',
  },
})
