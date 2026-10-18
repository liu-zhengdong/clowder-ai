import type { ReactNode } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

function isSafeWebLink(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function InertLink({ children }: { readonly children: ReactNode }) {
  return <span className="message-markdown-inert-link">{children}</span>;
}

export function MessageMarkdown({
  source,
  prefix,
  sourceCoordinates = false,
}: {
  readonly source: string;
  readonly prefix?: ReactNode;
  readonly sourceCoordinates?: boolean;
}) {
  const position = (node?: { position?: { start: { offset?: number }; end: { offset?: number } } }) =>
    sourceCoordinates
      ? {
          'data-source-start': node?.position?.start.offset,
          'data-source-end': node?.position?.end.offset,
        }
      : {};
  const sourceComponents: Components = sourceCoordinates
    ? {
        p: ({ node, ...props }) => <p {...props} {...position(node)} />,
        h1: ({ node, ...props }) => <h1 {...props} {...position(node)} />,
        h2: ({ node, ...props }) => <h2 {...props} {...position(node)} />,
        h3: ({ node, ...props }) => <h3 {...props} {...position(node)} />,
        li: ({ node, ...props }) => <li {...props} {...position(node)} />,
        td: ({ node, ...props }) => <td {...props} {...position(node)} />,
        pre: ({ node, ...props }) => <pre {...props} {...position(node)} />,
      }
    : {};
  return (
    <div className="message-body message-markdown">
      {prefix}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={defaultUrlTransform}
        components={{
          ...sourceComponents,
          a: ({ children, href }) =>
            isSafeWebLink(href) ? (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ) : (
              <InertLink>{children}</InertLink>
            ),
          img: ({ alt }) => <span className="message-markdown-inert-image">{alt ? `图片：${alt}` : '图片'}</span>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
