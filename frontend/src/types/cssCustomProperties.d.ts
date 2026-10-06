import 'react';

declare module 'react' {
  interface CSSProperties {
    /** Read by the `text-data-color` utility in styles/index.css. */
    '--data-color'?: string | undefined;
  }
}
