export interface EmbeddingProvider {
  readonly dimension: number;
  embedQuery(text: string): Promise<number[]>;
  embedPassage(text: string): Promise<number[]>;
}
