// The UI only talks to this interface. Today it is backed by plain addon
// requests (Cinemeta); later it can be backed by stremio-core-web without
// touching any screen.

export type ContentType = 'movie' | 'series';

export interface MetaPreview {
  id: string;
  type: ContentType;
  name: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
  genres?: string[];
  imdbRating?: string;
  poster?: string;
  background?: string;
  logo?: string;
}

export interface Video {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  released?: string;
  overview?: string;
  thumbnail?: string;
}

export interface MetaDetails extends MetaPreview {
  cast?: string[];
  director?: string[];
  videos: Video[];
  trailerYtId?: string;
}

export interface Row {
  id: string;
  title: string;
  items: MetaPreview[];
}

export interface ContentSource {
  homeRows(): Promise<Row[]>;
  meta(type: ContentType, id: string): Promise<MetaDetails>;
}
