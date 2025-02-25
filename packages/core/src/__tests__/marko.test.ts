import {
  componentToMarko,
  markoFormatHtml,
  preprocessHtml,
  postprocessHtml,
} from '../generators/marko';
import { runTestsForTarget } from './shared';

describe('Marko format', () => {
  const exampleCode = `
    <div>
      <if(input.foo === 'bar')>
        Hello
      </if>
      <for|items| of=(some.long ? expression : yo)>
        World
      </for>
      <input 
        placeholder="Hello world..."
        value=(this.state.name) 
        on-click=(event => {
          console.log('hello', "world")
        })
        on-input=(event => this.state.name = event.target.value) /> 
        
        Hello! I can run in React, Vue, Solid, or Liquid!
    </div>`;
  const preprocessed = preprocessHtml(exampleCode);
  expect(preprocessed).toMatchSnapshot();
  expect(postprocessHtml(preprocessed)).toMatchSnapshot();
  expect(markoFormatHtml(exampleCode)).toMatchSnapshot();
});

describe('Marko', () => {
  runTestsForTarget('marko', componentToMarko());
});
