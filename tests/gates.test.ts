import { describe, expect, it } from 'vitest';
import { grooverProof, hangarCertified, solarProof } from '../mcp/src/gates.js';

const DID = 'did:groover:f60a3753b5ef6dd3';
const DID64 = 'did:groover:869a20477a1e9a8c15760b15502a6d616f196d6546111138d7110a65f8ec1df9';
const GRVR = 'eip155:8453:0x045B35480F289F8f83F53345A0f367875958957a/1';
const CITATION = '0xaf105e77eefeb1f0e6346f2899d0cea694178b0017360b4b64c3d8545c736e41';

describe('hangar Groover + Dynamo gates', () => {
  it('reads DID / GRVR from card services or groover block', () => {
    expect(grooverProof({ services: [{ name: 'DID', endpoint: DID }] })).toBe(DID);
    expect(grooverProof({ groover: { did: DID64 } })).toBe(DID64);
    expect(
      grooverProof({
        groover: {
          grvrContract: '0x045B35480F289F8f83F53345A0f367875958957a',
          grvrTokenId: '1',
        },
      }),
    ).toBe(GRVR);
    expect(grooverProof({ services: [{ name: 'GRVR', endpoint: GRVR }] })).toBe(GRVR);
    expect(grooverProof({ services: [{ name: 'DID', endpoint: 'did:groover:x' }] })).toBeUndefined();
    expect(grooverProof({ name: 'shop-only' })).toBeUndefined();
  });

  it('reads Dynamo PASS or 32-byte citation; fail closed if missing', () => {
    expect(solarProof({ groover: { dynamoCitation: CITATION } })).toBe(CITATION);
    expect(solarProof({ groover: { solar: { verdict: 'PASS' } } })).toBe('PASS');
    expect(solarProof({ groover: { solar: { verdict: 'PASS' }, dynamoCitation: CITATION } })).toBe(CITATION);
    expect(solarProof({ solar: { recommendation: 'NEEDS_REVISION' } })).toBeUndefined();
    expect(solarProof({ groover: { solar: { fullBox7DVerdict: 'REJECT' } } })).toBeUndefined();
    expect(solarProof({ groover: { did: DID } })).toBeUndefined();
  });

  it('certified requires both gates', () => {
    expect(hangarCertified({ groover: { did: DID } })).toBeUndefined();
    expect(hangarCertified({ groover: { dynamoCitation: CITATION } })).toBeUndefined();
    expect(
      hangarCertified({
        services: [{ name: 'DID', endpoint: DID }],
        groover: { dynamoCitation: CITATION },
      }),
    ).toEqual({ groover: DID, solar: CITATION });
  });
});
