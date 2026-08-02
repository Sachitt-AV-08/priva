export interface Node {
  id: string;
  type: NodeType;
  parent_id: string | null;
  root_id: string | null;
  sort_key: string;
  properties: string;
  content: string | null;
  icon: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type NodeType =
  | "note"
  | "task"
  | "product"
  | "purchase"
  | "list"
  | "page";

export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number;
  metadata: string;
  created_at: number;
}

export interface Column {
  id: string;
  database_id: string;
  name: string;
  type: ColumnType;
  config: string;
  sort_key: string;
  created_at: number;
}

export type ColumnType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "multi_select";

export interface Cell {
  row_id: string;
  column_id: string;
  value: string | null;
  updated_at: number;
}

export interface View {
  id: string;
  database_id: string | null;
  name: string;
  type: ViewType;
  config: string;
  sort_key: string;
  created_at: number;
  updated_at: number;
}

export type ViewType =
  | "document"
  | "table"
  | "graph";

export interface Event {
  sequence: number;
  aggregate_id: string;
  event_type: string;
  payload: string;
  recorded_at: number;
}

export interface NodeProperties {
  title?: string;
  status?: string;
  priority?: "p1" | "p2" | "p3" | "p4";
  due_date?: string;
  tags?: string[];
  completed?: boolean;
  price?: number;
  currency?: string;
  source?: string;
  image_url?: string;
  product_url?: string;
  rating?: number;
  order_date?: string;
  [key: string]: any;
}

export interface Command {
  type: string;
  payload: any;
}

export interface CommandResult {
  success: boolean;
  eventId: number;
  error?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  blocks: NoteBlock[];
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface NoteBlock {
  id: string;
  type: "text" | "heading" | "list" | "toggle" | "divider" | "drawing";
  content: string;
  meta?: Record<string, any>;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: "p1" | "p2" | "p3" | "p4";
  completed: boolean;
  due_date: string | null;
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface Product {
  id: string;
  title: string;
  price: number;
  currency: string;
  source: string;
  image_url: string;
  product_url: string;
  rating: number;
  description: string;
}

export interface Purchase {
  id: string;
  product_title: string;
  price: number;
  currency: string;
  source: string;
  order_date: string;
  status: "pending" | "completed" | "cancelled";
  image_url: string;
  product_url: string;
}

export function parseProperties(raw: string | null): NodeProperties {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function serializeProperties(props: NodeProperties): string {
  return JSON.stringify(props);
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}
