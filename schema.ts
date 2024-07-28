import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createInsertSchema } from 'drizzle-zod'
import type { SessionConfig } from './types'

export const builds = sqliteTable('builds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  buildId: text('buildId').notNull().unique(),
  imageName: text('imageName').notNull(),
  createdAt: text('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updatedAt')
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => sql`CURRENT_TIMESTAMP`),
})

export type Build = InferSelectModel<typeof builds>

export type BuildCreateOrUpdate = InferInsertModel<typeof builds>

export const buildCreateOrUpdateSchema = createInsertSchema(builds)

export const gameServerInstances = sqliteTable(
  'gameServerInstances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // gsdk allocator seems to use the docker container id as the server id,
    // it's also called sessionHostId in gsdk config file
    serverId: text('serverId').notNull(),
    buildId: text('buildId')
      .references(() => builds.buildId, { onDelete: 'restrict' })
      .notNull(),
    port: text('port').notNull(),
    sessionConfig: text('sessionConfig', { mode: 'json' }).notNull(),
    status: text('status', { enum: ['StandingBy', 'Active', 'Terminated'] }).notNull(),
    createdAt: text('createdAt').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updatedAt')
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => sql`CURRENT_TIMESTAMP`),
  },
  (table) => {
    return {
      serverIdIndex: index('serverIdIndex').on(table.serverId),
      statusIndex: index('statusIndex').on(table.status),
    }
  },
)

export type GameServerInstance = InferSelectModel<typeof gameServerInstances> & {
  sessionConfig: SessionConfig
}

export type GameServerInstanceCreateOrUpdate = InferInsertModel<typeof gameServerInstances> & {
  sessionConfig: SessionConfig
}
