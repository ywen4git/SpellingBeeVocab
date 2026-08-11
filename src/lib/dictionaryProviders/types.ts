export interface DefinitionAlternative {
  partOfSpeech: string;
  definition: string;
}

export type ProviderResult =
  | { status: 'ok'; alternatives: DefinitionAlternative[] }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'error' }
  | { status: 'network-error' };
