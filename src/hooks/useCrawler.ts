import { useState, useRef, useCallback } from 'react';
import { Property, DongProgress, SearchMeta, SavedSlot } from '../types';
import { CrawlerService, LogEntry, ProgressInfo, DoneSummary } from '../services/crawler';
import { CrawlerConfig } from '../types';

const EMPTY_META: SearchMeta = {
  largeName: '', midName: '', smallName: '', realEstateType: '', tradeType: '', areaLabel: '',
};

export type CrawlerStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error';

export interface CrawlerState {
  status: CrawlerStatus;
  logs: LogEntry[];
  progress: ProgressInfo | null;
  properties: Property[];
  summary: DoneSummary | null;
  errorMessage: string | null;
  searchType: string; // 검색에 사용한 상품 유형 (면적 표기 기준 판단용)
  dongs: DongProgress[]; // 동별 실시간 진행률 (사이드바 시각화)
  regionName: string;    // 진행률 패널 헤더용 지역명
  meta: SearchMeta;      // 검색 조건 스냅샷 (슬롯 저장용)
  lastConfig: CrawlerConfig | null; // 마지막 검색 조건 (슬롯 저장/재검색용)
}

let _uidCounter = 0;

export function useCrawler() {
  const [state, setState] = useState<CrawlerState>({
    status: 'idle',
    logs: [],
    progress: null,
    properties: [],
    summary: null,
    errorMessage: null,
    searchType: '',
    dongs: [],
    regionName: '',
    meta: EMPTY_META,
    lastConfig: null,
  });

  const crawlerRef = useRef<CrawlerService | null>(null);

  const start = useCallback((config: CrawlerConfig) => {
    crawlerRef.current?.stop();
    crawlerRef.current = null;

    setState({
      status: 'running',
      logs: [],
      progress: null,
      properties: [],
      summary: null,
      errorMessage: null,
      searchType: config.realEstateType,
      dongs: [],
      regionName: config.midName || config.legalDivisionName,
      meta: {
        largeName: config.largeName,
        midName: config.midName,
        smallName: config.smallName,
        realEstateType: config.realEstateType,
        tradeType: config.tradeType,
        areaLabel: config.areaLabel,
      },
      lastConfig: config,
    });

    const crawler = new CrawlerService({
      legalDivisionCode: config.legalDivisionCode,
      legalDivisionName: config.legalDivisionName,
      tradeType: config.tradeType,
      realEstateType: config.realEstateType,
      spcMin: config.spcMin,
      spcMax: config.spcMax,
      midName: config.midName,
      smallName: config.smallName,
      midCode: config.midCode,
      enumerateDongs: config.enumerateDongs,
      onLog: (msg: LogEntry) => {
        setState((prev) => ({
          ...prev,
          logs: [...prev.logs.slice(-499), msg],
        }));
      },
      onProgress: (progress: ProgressInfo) => {
        setState((prev) => ({ ...prev, progress }));
      },
      onProperty: (property: Property) => {
        property._uid = ++_uidCounter;
        setState((prev) => ({
          ...prev,
          properties: [...prev.properties, property],
        }));
      },
      onPropertyPatch: (articleNumber: string, patch: Partial<Property>) => {
        setState((prev) => ({
          ...prev,
          properties: prev.properties.map((p) =>
            p.articleNumber === articleNumber ? { ...p, ...patch } : p,
          ),
        }));
      },
      onDongs: (dongs: DongProgress[]) => {
        setState((prev) => ({ ...prev, dongs }));
      },
      onDone: (summary: DoneSummary) => {
        setState((prev) => ({
          ...prev,
          status: 'done',
          summary,
        }));
      },
      onError: (err: string) => {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: err,
        }));
      },
    });

    crawlerRef.current = crawler;
    crawler.start().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: message,
      }));
    });
  }, []);

  const stop = useCallback(() => {
    crawlerRef.current?.stop();
    setState((prev) => ({ ...prev, status: 'stopped' }));
  }, []);

  // 특정 동(인덱스) 건너뛰기 — 진행/대기 중인 동을 즉시 스킵
  const skipDong = useCallback((index: number) => {
    crawlerRef.current?.skipDong(index);
  }, []);

  const reset = useCallback(() => {
    crawlerRef.current?.stop();
    crawlerRef.current = null;
    setState({
      status: 'idle',
      logs: [],
      progress: null,
      properties: [],
      summary: null,
      errorMessage: null,
      searchType: '',
      dongs: [],
      regionName: '',
      meta: EMPTY_META,
      lastConfig: null,
    });
  }, []);

  const clearLogs = useCallback(() => {
    setState((prev) => ({ ...prev, logs: [] }));
  }, []);

  // 저장 슬롯 데이터를 현재 결과로 불러오기 (기존 결과 대체)
  const load = useCallback((slot: SavedSlot) => {
    crawlerRef.current?.stop();
    crawlerRef.current = null;
    setState({
      status: 'done',
      logs: [],
      progress: null,
      properties: slot.properties,
      summary: { totalComplexes: 0, totalProperties: slot.count, duration: 0 },
      errorMessage: null,
      searchType: slot.meta.realEstateType,
      dongs: [],
      regionName: slot.meta.midName || slot.meta.largeName,
      meta: slot.meta,
      lastConfig: slot.config,
    });
  }, []);

  return { state, start, stop, skipDong, reset, clearLogs, load };
}
