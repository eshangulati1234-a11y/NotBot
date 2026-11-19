import { useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, Eye, FileText, Folder, FolderSearch } from 'lucide-react';
import type { TreeNode } from '../lib/tree';
import { seenCount } from '../lib/tree';
import { EmptyState } from '../ui';
import './FolderTree.css';

interface Props {
  tree: TreeNode;
  folderName: string;
  folderPath: string;
}

function markFor(node: TreeNode): { state: string; label: string } | null {
  if (node.changed) return { state: 'changed', label: 'changed' };
  if (node.proposed) return { state: 'proposed', label: 'to change' };
  if (node.read) return { state: 'read', label: 'read' };
  return null;
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  closed: ReadonlySet<string>;
  active: string;
  onToggle: (path: string) => void;
  onActive: (path: string) => void;
}

function Node({ node, depth, closed, active, onToggle, onActive }: NodeProps) {
  const mark = markFor(node);
  const tabIndex = active === node.path ? 0 : -1;

  if (node.dir) {
    const open = !closed.has(node.path);
    return (
      <li role="none" className="nb-folder-tree__item">
        <button
          type="button"
          role="treeitem"
          aria-expanded={open}
          aria-level={depth}
          tabIndex={tabIndex}
          data-path={node.path}
          className="nb-folder-tree__row"
          onFocus={() => onActive(node.path)}
          onClick={() => onToggle(node.path)}
        >
          {open ? (
            <ChevronDown className="nb-folder-tree__chevron" aria-hidden="true" />
          ) : (
            <ChevronRight className="nb-folder-tree__chevron" aria-hidden="true" />
          )}
          <Folder className="nb-folder-tree__icon" aria-hidden="true" />
          <span className="nb-folder-tree__name">{node.name}</span>
        </button>
        {open && node.children.length > 0 ? (
          <ul role="group" className="nb-folder-tree__group">
            {node.children.map((child) => (
              <Node
                key={child.path}
                node={child}
                depth={depth + 1}
                closed={closed}
                active={active}
                onToggle={onToggle}
                onActive={onActive}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li role="none" className="nb-folder-tree__item">
      <div
        role="treeitem"
        aria-selected={false}
        aria-level={depth}
        tabIndex={tabIndex}
        data-path={node.path}
        className="nb-folder-tree__row nb-folder-tree__row--file"
        data-state={mark?.state}
        title={node.path}
        onFocus={() => onActive(node.path)}
      >
        <span className="nb-folder-tree__chevron" aria-hidden="true" />
        <FileText className="nb-folder-tree__icon" aria-hidden="true" />
        <span className="nb-folder-tree__name">{node.name}</span>
        {mark ? (
          <span className="nb-folder-tree__mark" data-state={mark.state}>
            {mark.state === 'read' ? <Eye className="nb-folder-tree__mark-icon" aria-hidden="true" /> : null}
            {mark.label}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function hasPath(node: TreeNode, path: string): boolean {
  return node.children.some((c) => c.path === path || (c.dir && hasPath(c, path)));
}

export function FolderTree({ tree, folderName, folderPath }: Props) {
  const count = seenCount(tree);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  // One tab stop for the whole tree: the last focused row, or the first row.
  const active = activePath !== null && hasPath(tree, activePath) ? activePath : (tree.children[0]?.path ?? '');

  const setOpen = (path: string, open: boolean) =>
    setClosed((prev) => {
      if (prev.has(path) !== open) return prev;
      const next = new Set(prev);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!row) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const at = rows.indexOf(row);
    const level = Number(row.getAttribute('aria-level'));
    const expanded = row.getAttribute('aria-expanded');
    const go = (el: HTMLElement | undefined) => {
      if (!el) return;
      e.preventDefault();
      el.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        go(rows[at + 1]);
        break;
      case 'ArrowUp':
        go(rows[at - 1]);
        break;
      case 'Home':
        go(rows[0]);
        break;
      case 'End':
        go(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (expanded === 'false') {
          e.preventDefault();
          setOpen(row.dataset.path ?? '', true);
        } else if (expanded === 'true') {
          const child = rows[at + 1];
          if (child && Number(child.getAttribute('aria-level')) > level) go(child);
        }
        break;
      case 'ArrowLeft':
        if (expanded === 'true') {
          e.preventDefault();
          setOpen(row.dataset.path ?? '', false);
        } else {
          go([...rows.slice(0, at)].reverse().find((r) => Number(r.getAttribute('aria-level')) < level));
        }
        break;
      default:
    }
  }
  return (
    <nav className="nb-folder-tree" aria-label="Files this helper has seen">
      <header className="nb-folder-tree__head">
        <span className="nb-folder-tree__folder" title={folderPath}>
          {folderName}
        </span>
        <span className="nb-folder-tree__count">
          {count === 0 ? 'Nothing seen yet' : `${count} ${count === 1 ? 'file' : 'files'} seen`}
        </span>
      </header>
      {count === 0 || tree.children.length === 0 ? (
        <div className="nb-folder-tree__empty">
          <EmptyState
            icon={FolderSearch}
            title="Nothing seen yet"
            body="This shows the files the helper has looked at, not everything in the folder. It fills in as the helper works."
          />
        </div>
      ) : (
        <ul role="tree" aria-label="Files seen so far" className="nb-folder-tree__tree" onKeyDown={onKeyDown}>
          {tree.children.map((child) => (
            <Node
              key={child.path}
              node={child}
              depth={1}
              closed={closed}
              active={active}
              onToggle={(path) => setOpen(path, closed.has(path))}
              onActive={setActivePath}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}
