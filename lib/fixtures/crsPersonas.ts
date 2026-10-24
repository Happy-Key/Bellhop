/**
 * CRS sandbox TEST PERSONAS (synthetic identities published by CRS for CalHacks 13).
 * Source: @crscreditapi/crs-calhacks-mcp-server dist/test-data/personas.json
 * ("CalHacks13(20261022)-CRS-Sandbox"). Bodies are copied verbatim for
 * POST /transunion/identity-manager-verification/basic.
 *
 * Only these bodies may be sent: a request that does not match a persona goes to the real
 * vendor and may be billable. CRS personas are unrelated to Nessie customers; linking one
 * to a case is a SYNTHETIC association for demonstration.
 */
export interface CrsPersona {
  id: string;
  name: string;
  /** CRS's documented expected result for the identity check. */
  expected: string;
  identityBody: {
    firstName: string;
    lastName: string;
    ssn: string;
    dob: string;
    street1: string;
    city: string;
    state: string;
    zip: string;
  };
}

export const CRS_PERSONAS: CrsPersona[] = [
  {
    id: "P01",
    name: "MARGARET OKAFOR",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "MARGARET", lastName: "OKAFOR", ssn: "666701001", dob: "1984-03-14", street1: "1420 WILLOW CREEK DR", city: "SAN JOSE", state: "CA", zip: "95125" },
  },
  {
    id: "P12",
    name: "VICTOR ANAND",
    expected: "result FAIL. SSN issued to a different name; DOB mismatch; address not associated with SSN",
    identityBody: { firstName: "VICTOR", lastName: "ANAND", ssn: "666701012", dob: "1968-08-08", street1: "55 WATER ST FL 20", city: "NEW YORK", state: "NY", zip: "10041" },
  },
  {
    id: "P14",
    name: "HAROLD PETTIGREW",
    expected: "result FAIL. SSN reported as belonging to a deceased person (Death Master File)",
    identityBody: { firstName: "HAROLD", lastName: "PETTIGREW", ssn: "666701014", dob: "1948-01-19", street1: "310 ELM ST", city: "DAYTON", state: "OH", zip: "45402" },
  },
  {
    id: "P16",
    name: "SAMUEL OYELARAN",
    expected: "result KBA_REQUIRED. basic verification passes but fraud alert triggers step-up (KBA/OTP not mocked in sandbox)",
    identityBody: { firstName: "SAMUEL", lastName: "OYELARAN", ssn: "666701016", dob: "1977-06-12", street1: "1200 BRICKELL BAY DR APT 2203", city: "MIAMI", state: "FL", zip: "33131" },
  },
  {
    id: "P19",
    name: "GRACE NAKAMURA",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "GRACE", lastName: "NAKAMURA", ssn: "666701019", dob: "1976-09-16", street1: "1850 SOLANO AVE", city: "BERKELEY", state: "CA", zip: "94707" },
  },
];

/** All CRS sandbox persona SSNs follow 6667010NN. */
export const CRS_PERSONA_SSN = /^6667010\d{2}$/;

export function getCrsPersona(id: string): CrsPersona | undefined {
  return CRS_PERSONAS.find((p) => p.id === id);
}
