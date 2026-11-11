import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderPlus,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import type {
  ProjectDiscovery,
  ProjectImportResponse,
  ProjectRootsResult,
} from '../../../shared/types';
import {
  discoverProjects,
  fetchProjectRoots,
  importProjects,
} from '../api';
import { errorMessage, PM_LABEL } from '../lib';

const ROOT_KEY = 'npm-atlas-import-root';
const DEPTHS = [1, 2, 3, 4, 5];
const MAX_IMPORT = 100;

interface ImportProjectsDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (result: ProjectImportResponse) => void;
}

export function ImportProjectsDialog({
  open,
  onClose,
  onImported,
}: ImportProjectsDialogProps) {
  const [roots, setRoots] = useState<ProjectRootsResult | null>(null);
  const [root, setRoot] = useState('');
  const [depth, setDepth] = useState(3);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [discovery, setDiscovery] = useState<ProjectDiscovery | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rootsRequested = useRef(false);
  const scanInFlight = useRef(false);

  useEffect(() => {
    if (!open) return;

    setDiscovery(null);
    setSelected(new Set());
    setQuery('');
    setError(null);
    setImporting(false);

    if (rootsRequested.current) return;
    rootsRequested.current = true;
    void fetchProjectRoots()
      .then((data) => {
        setRoots(data);
        let stored = '';
        try {
          stored = localStorage.getItem(ROOT_KEY) ?? '';
        } catch {
          // storage is optional
        }
        setRoot((previous) => previous || stored || data.defaultRoot);
      })
      .catch((cause) => {
        rootsRequested.current = false;
        setError(errorMessage(cause));
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !scanning && !importing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, scanning, importing, onClose]);

  const visible = useMemo(() => {
    if (!discovery) return [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return discovery.candidates;
    return discovery.candidates.filter(
      (candidate) =>
        candidate.name.toLowerCase().includes(keyword) ||
        candidate.displayPath.toLowerCase().includes(keyword) ||
        PM_LABEL[candidate.packageManager].includes(keyword),
    );
  }, [discovery, query]);

  const selectableVisible = visible.filter((candidate) => !candidate.imported);
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((candidate) => selected.has(candidate.path));
  const importableCount = discovery
    ? discovery.candidates.filter((candidate) => !candidate.imported).length
    : 0;
  const overLimit = importableCount > MAX_IMPORT;

  const toggle = (value: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(value)) {
        next.delete(value);
      } else if (next.size < MAX_IMPORT) {
        next.add(value);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        for (const candidate of selectableVisible) next.delete(candidate.path);
      } else {
        for (const candidate of selectableVisible) {
          if (next.size >= MAX_IMPORT) break;
          next.add(candidate.path);
        }
      }
      return next;
    });
  };

  const runScan = async (value: string) => {
    const target = value.trim();
    if (!target || scanInFlight.current) return;

    scanInFlight.current = true;
    setScanning(true);
    setError(null);
    setDiscovery(null);
    setSelected(new Set());
    setQuery('');
    setRoot(target);

    try {
      const result = await discoverProjects(target, depth);
      setDiscovery(result);
      setSelected(
        new Set(
          result.candidates
            .filter((candidate) => !candidate.imported)
            .slice(0, MAX_IMPORT)
            .map((candidate) => candidate.path),
        ),
      );
      try {
        localStorage.setItem(ROOT_KEY, target);
      } catch {
        // storage is optional
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  };

  const submit = async () => {
    if (!selected.size || importing) return;
    setImporting(true);
    setError(null);
    try {
      const result = await importProjects([...selected]);
      onImported(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !scanning && !importing) {
          onClose();
        }
      }}
    >
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label="导入项目"
      >
        <div className="dialog-head">
          <div className="dialog-icon accent">
            <FolderPlus size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dialog-title">导入项目</div>
            <div className="dialog-sub">
              扫描目录中的 package.json，选择要加入 npm-atlas 的项目。
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            disabled={scanning || importing}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="dialog-body import-body">
          <div className="field-label">项目目录</div>
          <div className="import-root-row">
            <input
              className="input plain"
              value={root}
              autoFocus
              placeholder="例如 ~/DevSpace"
              aria-label="要扫描的项目目录"
              onChange={(event) => setRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runScan(root);
                }
              }}
            />
            <select
              className="select import-depth"
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
              aria-label="扫描深度"
            >
              {DEPTHS.map((value) => (
                <option key={value} value={value}>
                  {value} 层
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!root.trim() || scanning}
              onClick={() => void runScan(root)}
            >
              {scanning ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Search size={14} />
              )}
              {scanning ? '扫描中' : '扫描'}
            </button>
          </div>

          {roots?.roots.length ? (
            <div className="root-chips">
              {roots.roots.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={`root-chip${root === item.path ? ' is-on' : ''}`}
                  disabled={scanning}
                  onClick={() => {
                    setRoot(item.path);
                    void runScan(item.path);
                  }}
                >
                  {item.displayPath}
                </button>
              ))}
            </div>
          ) : null}

          <div className="field-hint">
            跳过 node_modules、.git、构建产物等目录；最多向下 {depth} 层。
          </div>

          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          {scanning ? (
            <div className="discover-loading">
              <Loader2 size={14} className="spin" />
              正在扫描目录…
            </div>
          ) : null}

          {discovery && !scanning ? (
            <>
              <div className="discover-summary">
                <span>
                  {discovery.displayRoot} · 发现{' '}
                  <strong>{discovery.candidates.length}</strong> 个项目（扫描{' '}
                  {discovery.visited} 个目录）
                </span>
                <span className="discover-flags">
                  {discovery.truncated ? (
                    <span className="warn">结果已截断</span>
                  ) : null}
                  {overLimit ? (
                    <span className="warn">单次最多导入 {MAX_IMPORT} 个</span>
                  ) : null}
                </span>
              </div>

              {discovery.candidates.length ? (
                <div className="discover-tools">
                  <div className="search">
                    <Search size={14} />
                    <input
                      className="input"
                      value={query}
                      placeholder="筛选项目名或路径…"
                      aria-label="筛选扫描结果"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={!selectableVisible.length}
                    onClick={toggleAllVisible}
                  >
                    {allVisibleSelected ? '取消全选' : '全选'}
                  </button>
                  <span className="result-count">
                    {selected.size} 已选
                    {selected.size >= MAX_IMPORT ? ' · 已达上限' : ''}
                  </span>
                </div>
              ) : null}

              <div className="discover-list">
                {visible.length ? (
                  visible.map((candidate) => (
                    <label
                      key={candidate.path}
                      className={`discover-item${candidate.imported ? ' is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(candidate.path)}
                        disabled={candidate.imported || importing}
                        onChange={() => toggle(candidate.path)}
                      />
                      <div className="discover-main">
                        <div className="discover-title">
                          <span className="discover-name">
                            {candidate.name}
                          </span>
                          <span className="pm-pill">
                            {PM_LABEL[candidate.packageManager]}
                          </span>
                          {candidate.isPrivate ? (
                            <span className="source-pill">private</span>
                          ) : null}
                          {candidate.imported ? (
                            <span className="source-pill">已导入</span>
                          ) : null}
                        </div>
                        <div className="discover-path">
                          {candidate.displayPath}
                        </div>
                      </div>
                      <div className="discover-meta">
                        {candidate.dependencyCount} 生产 ·{' '}
                        {candidate.devDependencyCount} 开发
                        {!candidate.hasNodeModules ? ' · 未安装' : ''}
                      </div>
                    </label>
                  ))
                ) : (
                  <div className="discover-empty">
                    {discovery.candidates.length
                      ? '没有匹配的项目。'
                      : '这个目录下没有发现 Node 项目（需要包含 package.json）。'}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={scanning || importing}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected.size || selected.size > MAX_IMPORT || scanning || importing}
            onClick={() => void submit()}
          >
            {importing ? <Loader2 size={14} className="spin" /> : null}
            {importing
              ? '导入中…'
              : `导入选中${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}