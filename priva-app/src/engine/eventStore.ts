import { db } from "./database";
import { now, type Event } from "./types";

class EventStore {
  async append(aggregateId: string, eventType: string, payload: Record<string, any>): Promise<number> {
    const result = await db.execute(
      "INSERT INTO events (aggregate_id, event_type, payload, recorded_at) VALUES (?, ?, ?, ?)",
      [aggregateId, eventType, JSON.stringify(payload), now()]
    );
    return Number(result.lastInsertRowid);
  }

  async getEvents(aggregateId: string): Promise<Event[]> {
    return db.all<Event>(
      "SELECT * FROM events WHERE aggregate_id = ? ORDER BY sequence ASC",
      [aggregateId]
    );
  }

  async getEventsAfter(sequence: number, limit = 100): Promise<Event[]> {
    return db.all<Event>(
      "SELECT * FROM events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?",
      [sequence, limit]
    );
  }

  async getRecentEvents(limit = 50): Promise<Event[]> {
    return db.all<Event>(
      "SELECT * FROM events ORDER BY sequence DESC LIMIT ?",
      [limit]
    );
  }

  async getEventsByType(eventType: string, limit = 50): Promise<Event[]> {
    return db.all<Event>(
      "SELECT * FROM events WHERE event_type = ? ORDER BY sequence DESC LIMIT ?",
      [eventType, limit]
    );
  }

  async getLatestSequence(): Promise<number> {
    const row = await db.get<{ seq: number }>("SELECT COALESCE(MAX(sequence), 0) as seq FROM events");
    return row?.seq ?? 0;
  }

  async getUndoableEvents(aggregateId: string, limit = 50): Promise<Event[]> {
    return db.all<Event>(
      "SELECT * FROM events WHERE aggregate_id = ? ORDER BY sequence DESC LIMIT ?",
      [aggregateId, limit]
    );
  }
}

export const eventStore = new EventStore();
