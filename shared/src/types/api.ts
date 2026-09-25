/** Shapes the HTTP API returns, shared so the frontend cannot drift from it. */

export interface PaginationMeta {
  /** 1-based. */
  page: number;
  limit: number;
  /** Total matching the filter, not just this page. */
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** Error body every failing endpoint returns. */
export interface ApiErrorBody {
  error: string;
}
