import { parse } from '@vue/compiler-sfc';

export interface VueScriptExtraction {
  hasScript: boolean;
  hasScriptSetup: boolean;
  scriptContent: string;
  scriptSetupContent: string;
  lang: string;
  bindings?: Record<string, string>;
}

export class VueSfcParser {
  public extractScript(content: string, filename: string = 'component.vue'): VueScriptExtraction {
    try {
      const parsed = parse(content, { filename });
      const script = parsed.descriptor.script;
      const scriptSetup = parsed.descriptor.scriptSetup;

      const lang = scriptSetup?.lang || script?.lang || 'ts';
      const bindings = scriptSetup?.bindings as Record<string, string> | undefined;

      return {
        hasScript: Boolean(script),
        hasScriptSetup: Boolean(scriptSetup),
        scriptContent: script?.content || '',
        scriptSetupContent: scriptSetup?.content || '',
        lang,
        bindings,
      };
    } catch {
      return {
        hasScript: false,
        hasScriptSetup: false,
        scriptContent: '',
        scriptSetupContent: '',
        lang: 'ts',
      };
    }
  }
}
