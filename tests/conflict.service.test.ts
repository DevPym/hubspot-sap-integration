/**
 * Tests para conflict.service.ts — Resolución Last-Write-Wins.
 *
 * Verifica que el servicio decide correctamente:
 * - PROCEDER (shouldSync=true) cuando el evento es más nuevo
 * - DESCARTAR (shouldSync=false) cuando el evento es viejo
 * - PROCEDER cuando es el primer sync (lastSyncAt=null)
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateHubSpotEvent,
  evaluateSapBPEvent,
  evaluateSapSOEvent,
} from '../src/services/conflict.service';

// ---------------------------------------------------------------------------
// evaluateHubSpotEvent
// ---------------------------------------------------------------------------

describe('evaluateHubSpotEvent', () => {
  it('permite primer sync (lastSyncAt=null)', () => {
    const result = evaluateHubSpotEvent('CONTACT', Date.now(), null);
    expect(result.shouldSync).toBe(true);
    expect(result.reason).toContain('Primer sync');
  });

  it('permite evento más reciente que última sync', () => {
    const lastSync = new Date('2024-01-15T10:00:00Z');
    const eventTs = new Date('2024-01-15T10:30:00Z').getTime();

    const result = evaluateHubSpotEvent('CONTACT', eventTs, lastSync);
    expect(result.shouldSync).toBe(true);
    expect(result.eventTimestampMs).toBe(eventTs);
  });

  it('descarta evento más viejo que última sync', () => {
    const lastSync = new Date('2024-01-15T10:30:00Z');
    const eventTs = new Date('2024-01-15T10:00:00Z').getTime();

    const result = evaluateHubSpotEvent('COMPANY', eventTs, lastSync);
    expect(result.shouldSync).toBe(false);
    expect(result.reason).toContain('SKIPPED');
  });

  it('descarta evento con mismo timestamp (<=)', () => {
    const ts = new Date('2024-01-15T10:00:00Z');
    const result = evaluateHubSpotEvent('DEAL', ts.getTime(), ts);
    expect(result.shouldSync).toBe(false);
  });

  it('acepta eventTimestamp como string ISO', () => {
    const lastSync = new Date('2024-01-15T10:00:00Z');
    const result = evaluateHubSpotEvent('CONTACT', '2024-01-15T10:30:00Z', lastSync);
    expect(result.shouldSync).toBe(true);
  });

  it('rechaza timestamp inválido', () => {
    const lastSync = new Date('2024-01-15T10:00:00Z');
    const result = evaluateHubSpotEvent('CONTACT', 'invalid-date', lastSync);
    expect(result.shouldSync).toBe(false);
    expect(result.reason).toContain('inválido');
  });

  it('funciona con todos los entityTypes', () => {
    const types = ['CONTACT', 'COMPANY', 'DEAL'] as const;
    for (const type of types) {
      const result = evaluateHubSpotEvent(type, Date.now(), null);
      expect(result.shouldSync).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateSapBPEvent
// ---------------------------------------------------------------------------

describe('evaluateSapBPEvent', () => {
  it('permite primer sync (lastSyncAt=null)', () => {
    const result = evaluateSapBPEvent({
      BusinessPartnerCategory: '1',
      BusinessPartnerGrouping: 'BP02',
      CorrespondenceLanguage: 'ES',
      LastChangeDate: '/Date(1700000000000)/',
      LastChangeTime: 'PT12H00M00S',
    }, null);

    expect(result.shouldSync).toBe(true);
  });

  it('permite si LastChangeDate es null (BP no modificado)', () => {
    const result = evaluateSapBPEvent({
      BusinessPartnerCategory: '1',
      BusinessPartnerGrouping: 'BP02',
      CorrespondenceLanguage: 'ES',
      LastChangeDate: undefined,
    }, new Date('2024-01-15'));

    expect(result.shouldSync).toBe(true);
    expect(result.reason).toContain('null');
  });

  it('permite cambio más reciente que última sync', () => {
    const lastSync = new Date('2024-01-15T10:00:00Z');
    // epoch_ms mayor que lastSync + 12h de tiempo
    const dateEpoch = new Date('2024-01-15T00:00:00Z').getTime();

    const result = evaluateSapBPEvent({
      BusinessPartnerCategory: '1',
      BusinessPartnerGrouping: 'BP02',
      CorrespondenceLanguage: 'ES',
      LastChangeDate: `/Date(${dateEpoch})/`,
      LastChangeTime: 'PT12H00M00S',
    }, lastSync);

    expect(result.shouldSync).toBe(true);
  });

  it('descarta cambio más viejo', () => {
    const lastSync = new Date('2024-01-15T14:00:00Z');
    const dateEpoch = new Date('2024-01-15T00:00:00Z').getTime();

    const result = evaluateSapBPEvent({
      BusinessPartnerCategory: '1',
      BusinessPartnerGrouping: 'BP02',
      CorrespondenceLanguage: 'ES',
      LastChangeDate: `/Date(${dateEpoch})/`,
      LastChangeTime: 'PT10H00M00S', // 10:00 < 14:00
    }, lastSync);

    expect(result.shouldSync).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateSapSOEvent
// ---------------------------------------------------------------------------

describe('evaluateSapSOEvent', () => {
  it('permite primer sync (lastSyncAt=null)', () => {
    const result = evaluateSapSOEvent({
      SalesOrderType: 'OR',
      SalesOrganization: '4601',
      DistributionChannel: 'CF',
      OrganizationDivision: '10',
      SoldToParty: '100000030',
      LastChangeDateTime: '2024-01-15T10:30:00.000Z',
    }, null);

    expect(result.shouldSync).toBe(true);
  });

  it('permite cambio más reciente', () => {
    const lastSync = new Date('2024-01-15T10:00:00Z');

    const result = evaluateSapSOEvent({
      SalesOrderType: 'OR',
      SalesOrganization: '4601',
      DistributionChannel: 'CF',
      OrganizationDivision: '10',
      SoldToParty: '100000030',
      LastChangeDateTime: '2024-01-15T10:30:00.000Z',
    }, lastSync);

    expect(result.shouldSync).toBe(true);
  });

  it('descarta cambio más viejo', () => {
    const lastSync = new Date('2024-01-15T14:00:00Z');

    const result = evaluateSapSOEvent({
      SalesOrderType: 'OR',
      SalesOrganization: '4601',
      DistributionChannel: 'CF',
      OrganizationDivision: '10',
      SoldToParty: '100000030',
      LastChangeDateTime: '2024-01-15T10:00:00.000Z',
    }, lastSync);

    expect(result.shouldSync).toBe(false);
  });

  it('permite si LastChangeDateTime es null', () => {
    const result = evaluateSapSOEvent({
      SalesOrderType: 'OR',
      SalesOrganization: '4601',
      DistributionChannel: 'CF',
      OrganizationDivision: '10',
      SoldToParty: '100000030',
    }, new Date());

    expect(result.shouldSync).toBe(true);
    expect(result.reason).toContain('null');
  });
});
