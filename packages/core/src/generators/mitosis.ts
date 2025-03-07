import dedent from 'dedent';
import json5 from 'json5';
import { format } from 'prettier/standalone';
import { Transpiler } from '../types/transpiler';
import { fastClone } from '../helpers/fast-clone';
import { getComponents } from '../helpers/get-components';
import { getRefs } from '../helpers/get-refs';
import { getStateObjectStringFromComponent } from '../helpers/get-state-object-string';
import { mapRefs } from '../helpers/map-refs';
import { renderPreComponent } from '../helpers/render-imports';
import { METADATA_HOOK_NAME, selfClosingTags } from '../parsers/jsx';
import { MitosisComponent } from '../types/mitosis-component';
import { MitosisNode } from '../types/mitosis-node';
import { blockToReact, componentToReact } from './react';
import { checkHasState } from '../helpers/state';

export interface ToMitosisOptions {
  prettier?: boolean;
  format: 'react' | 'legacy';
}

export const DEFAULT_FORMAT: ToMitosisOptions['format'] = 'legacy';

// Special isValidAttributeName for Mitosis so we can allow for $ in names
const isValidAttributeName = (str: string) => {
  return Boolean(str && /^[$a-z0-9\-_:]+$/i.test(str));
};

export const blockToMitosis = (
  json: MitosisNode,
  toMitosisOptions: Partial<ToMitosisOptions> = {},
): string => {
  const options: ToMitosisOptions = {
    format: DEFAULT_FORMAT,
    ...toMitosisOptions,
  };
  if (options.format === 'react') {
    return blockToReact(json, {
      format: 'lite',
      stateType: 'useState',
      stylesType: 'emotion',
      prettier: options.prettier,
    });
  }

  if (json.name === 'For') {
    const needsWrapper = json.children.length !== 1;
    return `<For each={${json.bindings.each?.code}}>
    {(${json.properties._forName}, index) =>
      ${needsWrapper ? '<>' : ''}
        ${json.children.map((child) => blockToMitosis(child, options))}}
      ${needsWrapper ? '</>' : ''}
    </For>`;
  }

  if (json.properties._text) {
    return json.properties._text as string;
  }

  if (json.bindings._text?.code) {
    return `{${json.bindings._text?.code}}`;
  }

  let str = '';

  str += `<${json.name} `;

  if (json.bindings._spread?.code) {
    str += ` {...(${json.bindings._spread.code})} `;
  }

  for (const key in json.properties) {
    const value = (json.properties[key] || '').replace(/"/g, '&quot;').replace(/\n/g, '\\n');

    if (!isValidAttributeName(key)) {
      console.warn('Skipping invalid attribute name:', key);
    } else {
      str += ` ${key}="${value}" `;
    }
  }
  for (const key in json.bindings) {
    const value = json.bindings[key]?.code as string;
    if (key === '_spread') {
      continue;
    }

    if (key.startsWith('on')) {
      str += ` ${key}={event => ${value.replace(/\s*;$/, '')}} `;
    } else {
      if (!isValidAttributeName(key)) {
        console.warn('Skipping invalid attribute name:', key);
      } else {
        str += ` ${key}={${value}} `;
      }
    }
  }
  if (selfClosingTags.has(json.name)) {
    return str + ' />';
  }

  // Self close by default if no children
  if (!json.children.length) {
    str += ' />';
    return str;
  }
  str += '>';
  if (json.children) {
    str += json.children.map((item) => blockToMitosis(item, options)).join('\n');
  }

  str += `</${json.name}>`;

  return str;
};

const getRefsString = (json: MitosisComponent, refs = Array.from(getRefs(json))) => {
  let str = '';

  for (const ref of refs) {
    const typeParameter = json['refs'][ref]?.typeParameter || '';
    const argument = json['refs'][ref]?.argument || '';
    str += `\nconst ${ref} = useRef${typeParameter ? `<${typeParameter}>` : ''}(${argument});`;
  }

  return str;
};

const mitosisCoreComponents = ['Show', 'For'];

export const componentToMitosis =
  (toMitosisOptions: Partial<ToMitosisOptions> = {}): Transpiler =>
  ({ component }) => {
    const options: ToMitosisOptions = {
      format: DEFAULT_FORMAT,
      ...toMitosisOptions,
    };

    if (options.format === 'react') {
      return componentToReact({
        format: 'lite',
        stateType: 'useState',
        stylesType: 'emotion',
        prettier: options.prettier,
      })({ component });
    }

    const json = fastClone(component);

    const domRefs = getRefs(component);
    // grab refs not used for bindings
    const jsRefs = Object.keys(component.refs).filter((ref) => domRefs.has(ref));

    const refs = [...jsRefs, ...Array.from(domRefs)];

    mapRefs(json, (refName) => {
      return `${refName}${domRefs.has(refName) ? `.current` : ''}`;
    });

    const addWrapper = json.children.length !== 1;

    const components = Array.from(getComponents(json));

    const mitosisComponents = components.filter((item) => mitosisCoreComponents.includes(item));
    const otherComponents = components.filter((item) => !mitosisCoreComponents.includes(item));

    const hasState = checkHasState(component);

    const needsMitosisCoreImport = Boolean(hasState || refs.length || mitosisComponents.length);

    const stringifiedUseMetadata = json5.stringify(component.meta.useMetadata);

    // TODO: smart only pull in imports as needed
    let str = dedent`
    ${
      !needsMitosisCoreImport
        ? ''
        : `import { ${!hasState ? '' : 'useStore, '} ${
            !refs.length ? '' : 'useRef, '
          } ${mitosisComponents.join(', ')} } from '@builder.io/mitosis';`
    }
    ${!otherComponents.length ? '' : `import { ${otherComponents.join(',')} } from '@components';`}
    ${json.types ? json.types.join('\n') : ''}
    ${json.interfaces ? json.interfaces?.join('\n') : ''}

    ${renderPreComponent({ component: json, target: 'mitosis' })}

    ${
      stringifiedUseMetadata && stringifiedUseMetadata !== '{}'
        ? `${METADATA_HOOK_NAME}(${stringifiedUseMetadata})`
        : ''
    }

    export default function ${component.name}(props) {
      ${!hasState ? '' : `const state = useStore(${getStateObjectStringFromComponent(json)});`}
      ${getRefsString(json, refs)}

      ${!json.hooks.onMount?.code ? '' : `onMount(() => { ${json.hooks.onMount.code} })`}

      ${!json.hooks.onUnMount?.code ? '' : `onUnMount(() => { ${json.hooks.onUnMount.code} })`}

      return (${addWrapper ? '<>' : ''}
        ${json.children.map((item) => blockToMitosis(item, options)).join('\n')}
        ${addWrapper ? '</>' : ''})
    }

  `;

    if (options.prettier !== false) {
      try {
        str = format(str, {
          parser: 'typescript',
          plugins: [
            require('prettier/parser-typescript'), // To support running in browsers
          ],
        });
      } catch (err) {
        console.error('Format error for file:', str, JSON.stringify(json, null, 2));
        throw err;
      }
    }
    return str;
  };
