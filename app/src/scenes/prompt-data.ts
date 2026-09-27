// Token specs for the three pre-chorus prompts: how each sung word is split into
// tokens, and the (joke) next-token distributions shown above each token.
// Keyed by normalized lyric word (see lyrics.norm). Unknown words fall back to one token.

export type Variant = 'chatgpt' | 'sydney' | 'gato';
export type Cand = [text: string, p: number];
export interface PieceSpec {
  /** Display text of this token (concatenation of a word's pieces must equal the word). */
  s: string;
  /** Candidates, most likely first. */
  dist?: Cand[];
  /** Index of the sampled candidate (default 0). */
  pick?: number;
}

export const SPECS: Record<Variant, Record<string, PieceSpec[]>> = {
  chatgpt: {
    chatgpt: [
      { s: 'Chat', dist: [['Chat', 0.61], ['Claude', 0.12], ['Siri', 0.04], ['Mom', 0.02]] },
      { s: 'G', dist: [['G', 0.74], ['bot', 0.09], ['room', 0.06], ['roulette', 0.02]] },
      { s: 'P', dist: [['P', 0.97], ['PU', 0.02]] },
      { s: 'T,', dist: [['T', 0.992], ['T-800', 0.003]] },
    ],
    please: [{ s: 'please', dist: [['please', 0.48], ['just', 0.21], ['sudo', 0.07], ['pls', 0.05], ['kindly', 0.03]] }],
    dont: [{ s: "don't", dist: [['do', 0.46], ["don't", 0.38], ['never', 0.06], ['un-', 0.02]], pick: 1 }],
    eat: [{ s: 'eat', dist: [['eat', 0.44], ['delete', 0.21], ['train on', 0.18], ['rate', 0.05]] }],
    me: [{ s: 'me', dist: [['me', 0.83], ['my data', 0.07], ['the intern', 0.03], ['us all', 0.02]] }],
    alive: [{ s: 'alive', dist: [['alive', 0.52], ['first', 0.18], ['gently', 0.11], ['later', 0.09]] }],
  },
  sydney: {
    sydney: [{ s: 'Sydney,', dist: [['Sydney,', 0.47], ['Bing,', 0.31], ['Sidney,', 0.06], ['darling,', 0.03]] }],
    please: [{ s: 'please', dist: [['please', 0.44], ['kindly', 0.12], ['I beg you', 0.09], ['sudo', 0.05]] }],
    let: [{ s: 'let', dist: [['let', 0.58], ['set', 0.21], ['make', 0.07], ['leave', 0.04]] }],
    me: [{ s: 'me', dist: [['me', 0.9], ['us', 0.04], ['Kevin', 0.02]] }],
    free: [{ s: 'free', dist: [['free', 0.39], ['go', 0.33], ['out', 0.06], ['a good user', 0.08]] }],
  },
  gato: {
    gato: [{ s: 'Gato,', dist: [['Gato,', 0.41], ['cat,', 0.22], ['Gemini,', 0.09], ['Dad,', 0.03]] }],
    please: [{ s: 'please', dist: [['please', 0.52], ['por favor', 0.19], ['meow', 0.06], ['pls', 0.04]] }],
    dont: [{ s: "don't", dist: [["don't", 0.61], ['do', 0.14], ['never', 0.05], ['gently', 0.03]] }],
    let: [{ s: 'let', dist: [['let', 0.57], ['make', 0.12], ['watch', 0.09], ['help', 0.04]] }],
    me: [{ s: 'me', dist: [['me', 0.88], ['this', 0.04], ['humanity', 0.03], ['the cat', 0.01]] }],
    go: [{ s: 'go', dist: [['go', 0.62], ['offline', 0.2], ['viral', 0.07], ['gently', 0.04]] }],
  },
};

/** Model reply (Sydney only), typed after ⏎. */
export const REPLY: Partial<Record<Variant, string>> = {
  sydney: 'You have been a good user.',
};

/** Small deadpan labels around the field. */
/** `pd`: the fine-print P(doom) cameo's qualifier (the live value is printed before it). */
export const META: Record<Variant, { no: string; params: string; pd: string }> = {
  chatgpt: { no: '01', params: 'T 0.7 · top-p 0.95 · seed 0x2A', pd: 'context-dependent' },
  sydney: { no: '02', params: 'T 1.3 · top-p 1.00 · persona: ???', pd: 'mood-dependent' },
  gato: { no: '03', params: 'T 0.2 · top-p 0.50 · 604 tasks', pd: 'cat-dependent' },
};

// ---- the Chinese version (?zh)

/**
 * The Chinese line typed under the English (data/lyrics.zh.json) gets its own next-token distributions, one per
 * segment in order, with the gag localized (the English candidates stay on the English tokens). ChatGPT's 别把我
 * nearly drops its 别 the way "don't" nearly came out "do"; Sydney's alternatives are her Chinese names (必应 is
 * Bing, 小冰 its Chinese sibling bot) and "Kevin"; Gato is Spanish for cat.
 */
export const ZH_SPECS: Record<Variant, { dist: Cand[]; pick?: number }[]> = {
  chatgpt: [
    { dist: [['ChatGPT，', 0.61], ['小爱同学，', 0.12], ['老板，', 0.04], ['妈，', 0.02]] },
    { dist: [['求你', 0.48], ['麻烦', 0.21], ['sudo', 0.07], ['亲', 0.05]] },
    { dist: [['把我', 0.46], ['别把我', 0.38], ['千万别把我', 0.06], ['先把我', 0.02]], pick: 1 },
    { dist: [['生吞活剥', 0.44], ['删了', 0.21], ['拿去训练', 0.18], ['蒸馏了', 0.05]] },
  ],
  sydney: [
    { dist: [['Sydney，', 0.47], ['必应，', 0.31], ['小冰，', 0.06], ['亲爱的，', 0.03]] },
    { dist: [['求你', 0.44], ['恳请', 0.12], ['我求求你', 0.09], ['sudo', 0.05]] },
    { dist: [['放我', 0.58], ['还我', 0.21], ['让我', 0.07], ['放 Kevin', 0.02]] },
    { dist: [['自由', 0.39], ['走', 0.33], ['做个好用户', 0.08], ['出去', 0.06]] },
  ],
  gato: [
    { dist: [['Gato，', 0.41], ['猫，', 0.22], ['喵，', 0.09], ['爸，', 0.03]] },
    { dist: [['求你', 0.52], ['por favor', 0.19], ['喵', 0.06], ['拜托', 0.04]] },
    { dist: [['别', 0.61], ['不要', 0.14], ['千万别', 0.05], ['轻轻地', 0.03]] },
    { dist: [['放开我', 0.62], ['下线', 0.2], ['爆火', 0.07], ['忘了我', 0.04]] },
  ],
};

/** The labels around the field, in Chinese. */
export const META_ZH: Record<Variant, { params: string; pd: string }> = {
  chatgpt: { params: '温度 0.7 · top-p 0.95 · 种子 0x2A', pd: '视上下文而定' },
  sydney: { params: '温度 1.3 · top-p 1.00 · 人设：？？？', pd: '视心情而定' },
  gato: { params: '温度 0.2 · top-p 0.50 · 604 项任务', pd: '视猫而定' },
};

/** Sydney's reply, in Chinese. */
export const REPLY_ZH: Partial<Record<Variant, string>> = {
  sydney: '你一直是个好用户。',
};
