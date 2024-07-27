import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core'
import { InferInsertModel, sql } from 'drizzle-orm'
import { SessionConfig } from './types'

export const builds = sqliteTable('builds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  buildId: text('buildId').notNull().unique(),
  imageName: text('imageName').notNull(),
  createdAt: text('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updatedAt').default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => sql`CURRENT_TIMESTAMP`)
})

export type Build = InferInsertModel<typeof builds>

export const gameServerInstances = sqliteTable('gameServerInstances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // gsdk allocator seems to use the docker container id as the server id,
  // it's also called sessionHostId in gsdk config file
  serverId: text('serverId').notNull(),
  buildId: text('buildId').references(() => builds.buildId, { onDelete: 'restrict' }).notNull(),
  port: text('port').notNull(),
  sessionConfig: text('sessionConfig', { mode: 'json' }).notNull(),
  createdAt: text('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updatedAt').default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => sql`CURRENT_TIMESTAMP`)
}, (table) => {
  return {
    serverIdIndex: index('serverIdIndex').on(table.serverId),
  }
})

export type GameServerInstance = InferInsertModel<typeof gameServerInstances> & {
  sessionConfig: SessionConfig
}
