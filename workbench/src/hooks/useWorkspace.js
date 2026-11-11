'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {deleteReference, isFatal, readJSON, RequestError, uploadFile} from '../lib/client/api';

export default function useWorkspace() {
  const [lessons, setLessons] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState(null);
  const health = useRef(null);
  const selection = useRef('');
  const generation = useRef(0);
  const running = useRef(false);
  const failed = useRef(false);
  const mounted = useRef(false);

  const fail = useCallback(error => {
    if (!mounted.current || failed.current) return;
    failed.current = true;
    setFailure({
      message: error.message,
      status: error.status,
      kind: error.kind,
      resource: error.resource,
      projectRoot: health.current?.projectRoot,
      lessonId: selection.current,
    });
  }, []);

  const report = useCallback(error => {
    if (isFatal(error)) fail(error);
    else if (mounted.current) setNotice(error.message);
  }, [fail]);

  const checkHealth = useCallback(async signal => {
    const next = await readJSON('/api/health', {signal});
    if (next.app !== 'lesson-review-workspace' || typeof next.projectRoot !== 'string'
      || (health.current && next.projectRoot !== health.current.projectRoot)) {
      throw new RequestError('工作台服務與目前專案不符。', {kind: 'protocol', resource: '/api/health'});
    }
    health.current = next;
    return next;
  }, []);

  const selectLesson = useCallback(id => {
    selection.current = id;
    generation.current++;
    setSelectedId(id);
    setLesson(null);
    setNotice('');
    if (health.current) {
      const key = `lesson-review:${health.current.projectRoot}`;
      if (id) localStorage.setItem(key, id);
      else localStorage.removeItem(key);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('lesson', id);
      else url.searchParams.delete('lesson');
      history.replaceState(null, '', url);
    }
  }, []);

  const refreshLesson = useCallback(async (id, signal) => {
    const requested = generation.current;
    const next = await readJSON(`/api/lessons/${id}`, {signal});
    if (mounted.current && selection.current === id && generation.current === requested) {
      setLesson(previous => previous?.id === next.id
        && previous.documentHash === next.documentHash
        && previous.annotationHash === next.annotationHash
        && previous.documentToken === next.documentToken
        && previous.updatedAt === next.updatedAt ? previous : next);
    }
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const connection = await checkHealth(controller.signal);
        const result = await readJSON('/api/lessons', {signal: controller.signal});
        if (controller.signal.aborted) return;
        setLessons(result.lessons);
        const candidates = [new URLSearchParams(location.search).get('lesson'),
          localStorage.getItem(`lesson-review:${connection.projectRoot}`), result.lessons[0]?.id];
        selectLesson(candidates.find(id => result.lessons.some(item => item.id === id)) || '');
        setLoading(false);
      } catch (error) {
        if (!controller.signal.aborted) fail(error);
      }
    })();
    return () => { mounted.current = false; controller.abort(); };
  }, [checkHealth, fail, selectLesson]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    refreshLesson(selectedId, controller.signal).catch(error => {
      if (!controller.signal.aborted) report(error);
    });
    return () => controller.abort();
  }, [selectedId, refreshLesson, report]);

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    async function poll() {
      if (polling || running.current || failed.current || !health.current || document.hidden) return;
      polling = true;
      const requested = generation.current;
      try {
        await checkHealth(controller.signal);
        const result = await readJSON('/api/lessons', {signal: controller.signal});
        if (controller.signal.aborted || running.current || requested !== generation.current) return;
        setLessons(previous => previous.length === result.lessons.length
          && previous.every((item, index) => item.id === result.lessons[index].id && item.title === result.lessons[index].title)
          ? previous : result.lessons);
        const id = selection.current;
        if (id && !result.lessons.some(item => item.id === id)) { selectLesson(''); return; }
        if (id) await refreshLesson(id, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted && isFatal(error)) fail(error);
      } finally { polling = false; }
    }
    const timer = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [checkHealth, refreshLesson, selectLesson, fail]);

  const mutate = useCallback(async operation => {
    if (running.current) throw new Error('正在保存資料，請稍後再試。');
    running.current = true;
    setBusy(true);
    setNotice('');
    try {
      return await operation(health.current.token);
    } catch (error) {
      if (isFatal(error)) fail(error);
      throw error;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [fail]);

  const importLesson = useCallback(file => mutate(async token => {
    const imported = await uploadFile('/api/lessons', file, token);
    const result = await readJSON('/api/lessons');
    if (!mounted.current) return imported;
    setLessons(result.lessons);
    selectLesson(imported.id);
    return imported;
  }), [mutate, selectLesson]);

  const addReferences = useCallback((files, progress) => mutate(async token => {
    const id = selection.current;
    try {
      for (let index = 0; index < files.length; index++) {
        progress(`正在保存 ${index + 1} / ${files.length}：${files[index].name}`);
        await uploadFile(`/api/lessons/${id}/materials`, files[index], token);
      }
    } finally { await refreshLesson(id); }
  }), [mutate, refreshLesson]);

  const removeReference = useCallback(material => mutate(async token => {
    const id = selection.current;
    await deleteReference(id, material.id, token);
    await refreshLesson(id);
  }), [mutate, refreshLesson]);

  const replaceDocument = useCallback(file => mutate(async token => {
    const id = selection.current;
    generation.current++;
    await uploadFile(`/api/lessons/${id}/document`, file, token);
    generation.current++;
    return refreshLesson(id);
  }), [mutate, refreshLesson]);

  const refreshCurrent = useCallback(() => {
    if (!selection.current) return;
    refreshLesson(selection.current).catch(report);
  }, [refreshLesson, report]);

  return {lessons, selectedId, lesson, loading, busy, notice, failure,
    selectLesson, importLesson, replaceDocument, refreshCurrent, addReferences, removeReference, setNotice, report};
}
