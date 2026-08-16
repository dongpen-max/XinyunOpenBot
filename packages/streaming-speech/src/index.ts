export interface SpeechChunkerOptions {
  minCharacters?: number;
  maxCharacters?: number;
}

export class StreamingSpeechChunker {
  private buffer = "";
  private readonly minCharacters: number;
  private readonly maxCharacters: number;

  constructor(options: SpeechChunkerOptions = {}) {
    this.minCharacters = options.minCharacters ?? 24;
    this.maxCharacters = options.maxCharacters ?? 180;
  }

  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];
    while (this.buffer.length >= this.minCharacters) {
      const window = this.buffer.slice(0, this.maxCharacters);
      const sentence = [...window.matchAll(/[。！？!?；;\n](?=\s|$|[^\s])/g)].at(-1);
      const comma = [...window.matchAll(/[，,、:：](?=\s|$|[^\s])/g)].at(-1);
      const cut = sentence ? sentence.index! + sentence[0].length : this.buffer.length >= this.maxCharacters && comma ? comma.index! + comma[0].length : -1;
      if (cut < 0) break;
      const chunk = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut).trimStart();
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }

  flush(): string[] {
    const final = this.buffer.trim();
    this.buffer = "";
    return final ? [final] : [];
  }
}
