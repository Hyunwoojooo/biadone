import {useCallback, useEffect, useRef, useState} from 'react';
import type {EditorCommand, Job, Project, ProjectSummary, SystemStatus} from '../shared/types';
import {applyCommand, withCommandSeed} from '../domain/project';
import {ApiError, api} from './api';

export type SaveState = 'loading'|'saved'|'saving'|'error'|'conflict';


export function useStudio() {
  const [project, setProject] = useState<Project|null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [system, setSystem] = useState<SystemStatus|null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const saved = useRef<Project|null>(null);
  const visible = useRef<Project|null>(null);
  const pending = useRef<EditorCommand[]>([]);
  const running = useRef(false);
  const blocked = useRef(false);
  const mounted = useRef(true);
  const flushWaiters = useRef<{resolve: () => void; reject: (error: Error) => void}[]>([]);

  const update = useCallback((p: Project) => {visible.current = p; setProject(p);}, []);
  const adopt = useCallback((p: Project) => {
    if (saved.current?.id !== p.id) setJobs([]);
    saved.current = p; pending.current = []; blocked.current = false;
    update(p); setSaveState('saved'); setError('');
    localStorage.setItem('biadone-project', p.id);
  }, [update]);

  const adoptIfIdle = useCallback((p: Project, base: Project) => {
    if (p.id !== base.id || running.current || blocked.current || pending.current.length || saved.current?.id !== base.id || saved.current.revision !== base.revision) return false;
    adopt(p); return true;
  }, [adopt]);
  const refreshSystem = useCallback(async () => {setSystem(await api.system());}, []);

  const refreshProjects = useCallback(async () => {setProjects(await api.projects());}, []);

  const pump = useCallback(async () => {
    if (running.current || blocked.current || !saved.current || pending.current.length === 0) return;
    running.current = true;
    setSaveState('saving');
    while (pending.current.length && !blocked.current && saved.current) {
      try {
        const next = await api.command(saved.current.id, pending.current[0], saved.current.revision);
        if (!mounted.current) break;
        saved.current = next;
        pending.current.shift();
        let rebased = next;
        for (const command of pending.current) rebased = applyCommand(rebased, command);
        update(rebased);
      } catch (caught) {
        const failure = caught instanceof Error ? caught : new Error('저장하지 못했습니다.');
        blocked.current = true;
        setSaveState(caught instanceof ApiError && caught.status === 409 ? 'conflict' : 'error');
        setError(failure.message);
        flushWaiters.current.splice(0).forEach(waiter => waiter.reject(failure));
      }
    }
    running.current = false;
    if (!blocked.current && pending.current.length === 0) {
      setSaveState('saved');
      flushWaiters.current.splice(0).forEach(waiter => waiter.resolve());
    }
  }, [update]);

  const dispatch = useCallback((input: EditorCommand) => {
    const command = withCommandSeed(input);
    if (!visible.current || blocked.current) return;
    try {
      const next = applyCommand(visible.current, command);
      update(next); pending.current.push(command); setSaveState('saving');
      void pump(); return next;
    } catch (caught) {setNotice(caught instanceof Error ? caught.message : '변경을 적용하지 못했습니다.');}
  }, [pump, update]);

  const flush = useCallback(async () => {
    if (blocked.current) throw new Error('저장 문제를 해결한 후 다시 시도해 주세요.');
    if (!running.current && pending.current.length === 0) return;
    await new Promise<void>((resolve, reject) => {flushWaiters.current.push({resolve, reject}); void pump();});
  }, [pump]);

  const load = useCallback(async (id: string) => {
    await flush(); adopt(await api.project(id)); setJobs([]);
  }, [adopt, flush]);

  const create = useCallback(async (title: string, demo = false) => {
    await flush(); adopt(await api.createProject({title, demo}));
    await refreshProjects();
  }, [adopt, flush, refreshProjects]);

  const resolveSave = useCallback(async (reapply: boolean) => {
    if (!saved.current || running.current) return;
    const commands = [...pending.current];
    try {
      const remote = await api.project(saved.current.id);
      if (reapply) {
        let draft = remote;
        for (const command of commands) draft = applyCommand(draft, command);
        // Validate the entire rebase before replacing the recoverable local draft.
        saved.current = remote; pending.current = commands; blocked.current = false;
        setError(''); update(draft); setSaveState(commands.length ? 'saving' : 'saved'); void pump();
      } else adopt(remote);
    } catch (caught) {setError(caught instanceof Error ? caught.message : '복구에 실패했습니다.'); setSaveState('conflict');}
  }, [adopt, pump, update]);

  const historyAction = useCallback(async (action: 'undo'|'redo', historyId?: string) => {
    await flush();
    if (!saved.current) return;
    const p = saved.current;
    adopt(historyId ? await api.restore(p.id, historyId, p.revision) : await api[action](p.id, p.revision));
  }, [adopt, flush]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [list, status] = await Promise.all([api.projects(), api.system()]);
        if (cancelled) return;
        setProjects(list); setSystem(status);
        const remembered = localStorage.getItem('biadone-project');
        const id = list.find(p => p.id === remembered)?.id ?? list[0]?.id;
        const p = id ? await api.project(id) : await api.createProject({demo: true});
        if (cancelled) return;
        adopt(p); await refreshProjects();
      } catch (caught) {
        if (!cancelled) {setError(caught instanceof Error ? caught.message : '에디터를 열지 못했습니다.'); setSaveState('error');}
      }
    })();
    return () => {cancelled = true; mounted.current = false;};
  }, [adopt, refreshProjects]);

  useEffect(() => {
    if (!project?.id) return;
    const id = project.id;
    let stopped = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const list = await api.jobs(id);
        if (stopped) return;
        setJobs(list);
        if (!running.current && !blocked.current && !pending.current.length) {
          const requestedRevision = saved.current?.revision;
          const remote = await api.project(id);
          // A poll may finish after a user starts typing/saving. Never clear that draft.
          if (!stopped && !running.current && !blocked.current && !pending.current.length && saved.current?.id === id && saved.current.revision === requestedRevision && remote.revision > saved.current.revision) adopt(remote);
        }
      } catch { /* A transient background poll must not discard the editor's local draft. */ }
      finally {inFlight = false;}
    };
    void poll(); const timer = window.setInterval(() => void poll(), 2000);
    return () => {stopped = true; window.clearInterval(timer);};
  }, [project?.id, adopt]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.current.length || running.current) {event.preventDefault(); event.returnValue = '';}
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const committed = useCallback(() => saved.current, []);
  return {project, projects, system, jobs, saveState, error, notice, setNotice, setError, dispatch, flush, load, create, adopt, historyAction, resolveSave, refreshProjects, refreshSystem, adoptIfIdle, committed};
}
