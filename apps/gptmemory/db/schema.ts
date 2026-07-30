import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    title: text("title").notNull(),
    overview: text("overview").notNull().default(""),
    sectionsJson: text("sections_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),
    sourceMessageCount: integer("source_message_count"),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("notes_owner_view_updated_idx").on(
      table.ownerKey,
      table.deletedAt,
      table.archived,
      table.favorite,
      table.updatedAt,
    ),
    uniqueIndex("notes_owner_source_url_unique_idx")
      .on(table.ownerKey, table.sourceUrl)
      .where(sql`${table.sourceUrl} IS NOT NULL`),
  ],
);

export type NoteRow = typeof notes.$inferSelect;
export type NewNoteRow = typeof notes.$inferInsert;
