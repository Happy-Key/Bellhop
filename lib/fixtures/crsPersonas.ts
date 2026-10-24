/**
 * CRS sandbox TEST PERSONAS (synthetic identities published by CRS for CalHacks 13).
 * Source: @crscreditapi/crs-calhacks-mcp-server dist/test-data/personas.json
 * ("CalHacks13(20261022)-CRS-Sandbox"; package 1.1.2 re-read 2026-10-24; P02–P20 added for
 * the claim suite the same day). Only the identity and Fraud Finder bodies are kept: this app never
 * requests credit reports, criminal or eviction records. Bodies are copied
 * verbatim for POST /transunion/identity-manager-verification/basic and
 * POST /fraud-finder/fraud-finder.
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
  /** CRS's documented expected Fraud Finder (AtData email risk) result. */
  fraudFinderExpected: string;
  fraudFinderBody: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    email: string;
    ipAddress: string;
    address: { addressLine1: string; city: string; state: string; postalCode: string };
  };
}

export const CRS_PERSONAS: CrsPersona[] = [
  {
    id: "P01",
    name: "MARGARET OKAFOR",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "MARGARET", lastName: "OKAFOR", ssn: "666701001", dob: "1984-03-14", street1: "1420 WILLOW CREEK DR", city: "SAN JOSE", state: "CA", zip: "95125" },
    fraudFinderExpected: "risk.score 11 (low)",
    fraudFinderBody: { firstName: "MARGARET", lastName: "OKAFOR", phoneNumber: "5550101001", email: "margaret.okafor@example.com", ipAddress: "203.0.113.11", address: { addressLine1: "1420 WILLOW CREEK DR", city: "SAN JOSE", state: "CA", postalCode: "95125" } },
  },
  {
    id: "P12",
    name: "VICTOR ANAND",
    expected: "result FAIL. SSN issued to a different name; DOB mismatch; address not associated with SSN",
    identityBody: { firstName: "VICTOR", lastName: "ANAND", ssn: "666701012", dob: "1968-08-08", street1: "55 WATER ST FL 20", city: "NEW YORK", state: "NY", zip: "10041" },
    fraudFinderExpected: "risk.score 85 (high), phone owner no_match, IP > 1000 miles",
    fraudFinderBody: { firstName: "VICTOR", lastName: "ANAND", phoneNumber: "5550101012", email: "v.anand.1968@example.com", ipAddress: "198.51.100.12", address: { addressLine1: "55 WATER ST FL 20", city: "NEW YORK", state: "NY", postalCode: "10041" } },
  },
  {
    id: "P14",
    name: "HAROLD PETTIGREW",
    expected: "result FAIL. SSN reported as belonging to a deceased person (Death Master File)",
    identityBody: { firstName: "HAROLD", lastName: "PETTIGREW", ssn: "666701014", dob: "1948-01-19", street1: "310 ELM ST", city: "DAYTON", state: "OH", zip: "45402" },
    fraudFinderExpected: "risk.score 80 (high), email invalid, phone dead",
    fraudFinderBody: { firstName: "HAROLD", lastName: "PETTIGREW", phoneNumber: "5550101014", email: "harold.pettigrew@example.com", ipAddress: "203.0.113.24", address: { addressLine1: "310 ELM ST", city: "DAYTON", state: "OH", postalCode: "45402" } },
  },
  {
    id: "P16",
    name: "SAMUEL OYELARAN",
    expected: "result KBA_REQUIRED. basic verification passes but fraud alert triggers step-up (KBA/OTP not mocked in sandbox)",
    identityBody: { firstName: "SAMUEL", lastName: "OYELARAN", ssn: "666701016", dob: "1977-06-12", street1: "1200 BRICKELL BAY DR APT 2203", city: "MIAMI", state: "FL", zip: "33131" },
    fraudFinderExpected: "risk.score 50 (medium)",
    fraudFinderBody: { firstName: "SAMUEL", lastName: "OYELARAN", phoneNumber: "5550101016", email: "samuel.oyelaran@example.com", ipAddress: "203.0.113.26", address: { addressLine1: "1200 BRICKELL BAY DR APT 2203", city: "MIAMI", state: "FL", postalCode: "33131" } },
  },
  {
    id: "P19",
    name: "GRACE NAKAMURA",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "GRACE", lastName: "NAKAMURA", ssn: "666701019", dob: "1976-09-16", street1: "1850 SOLANO AVE", city: "BERKELEY", state: "CA", zip: "94707" },
    fraudFinderExpected: "risk.score 9 (low)",
    fraudFinderBody: { firstName: "GRACE", lastName: "NAKAMURA", phoneNumber: "5550101019", email: "grace.nakamura@example.com", ipAddress: "203.0.113.29", address: { addressLine1: "1850 SOLANO AVE", city: "BERKELEY", state: "CA", postalCode: "94707" } },
  },
  {
    id: "P02",
    name: "DANIEL WHITFIELD",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "DANIEL", lastName: "WHITFIELD", ssn: "666701002", dob: "1972-11-02", street1: "88 LAKESHORE BLVD", city: "AUSTIN", state: "TX", zip: "78746" },
    fraudFinderExpected: "risk.score 9 (low)",
    fraudFinderBody: { firstName: "DANIEL", lastName: "WHITFIELD", phoneNumber: "5550101002", email: "daniel.whitfield@example.com", ipAddress: "203.0.113.12", address: { addressLine1: "88 LAKESHORE BLVD", city: "AUSTIN", state: "TX", postalCode: "78746" } },
  },
  {
    id: "P03",
    name: "JASMINE REYES",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "JASMINE", lastName: "REYES", ssn: "666701003", dob: "2004-06-21", street1: "2210 UNIVERSITY AVE APT 4B", city: "BERKELEY", state: "CA", zip: "94704" },
    fraudFinderExpected: "risk.score 14 (low), email 3 yrs",
    fraudFinderBody: { firstName: "JASMINE", lastName: "REYES", phoneNumber: "5550101003", email: "jasmine.reyes@example.com", ipAddress: "203.0.113.13", address: { addressLine1: "2210 UNIVERSITY AVE APT 4B", city: "BERKELEY", state: "CA", postalCode: "94704" } },
  },
  {
    id: "P04",
    name: "TOMAS LINDQVIST",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "TOMAS", lastName: "LINDQVIST", ssn: "666701004", dob: "1990-01-30", street1: "415 PINE ST UNIT 12", city: "SEATTLE", state: "WA", zip: "98101" },
    fraudFinderExpected: "risk.score 18 (low), email 1 yr",
    fraudFinderBody: { firstName: "TOMAS", lastName: "LINDQVIST", phoneNumber: "5550101004", email: "tomas.lindqvist@example.com", ipAddress: "203.0.113.14", address: { addressLine1: "415 PINE ST UNIT 12", city: "SEATTLE", state: "WA", postalCode: "98101" } },
  },
  {
    id: "P05",
    name: "RICKY DALTON",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "RICKY", lastName: "DALTON", ssn: "666701005", dob: "1988-09-09", street1: "7031 SUNSET RIDGE RD", city: "ORLANDO", state: "FL", zip: "32819" },
    fraudFinderExpected: "risk.score 52 (medium)",
    fraudFinderBody: { firstName: "RICKY", lastName: "DALTON", phoneNumber: "5550101005", email: "ricky.dalton@example.com", ipAddress: "203.0.113.15", address: { addressLine1: "7031 SUNSET RIDGE RD", city: "ORLANDO", state: "FL", postalCode: "32819" } },
  },
  {
    id: "P07",
    name: "MARCUS BELLAMY",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "MARCUS", lastName: "BELLAMY", ssn: "666701007", dob: "1975-12-05", street1: "1507 PEACHTREE INDUSTRIAL BLVD", city: "ATLANTA", state: "GA", zip: "30341" },
    fraudFinderExpected: "risk.score 12 (low)",
    fraudFinderBody: { firstName: "MARCUS", lastName: "BELLAMY", phoneNumber: "5550101007", email: "marcus.bellamy@example.com", ipAddress: "203.0.113.17", address: { addressLine1: "1507 PEACHTREE INDUSTRIAL BLVD", city: "ATLANTA", state: "GA", postalCode: "30341" } },
  },
  {
    id: "P08",
    name: "PRIYA VENKATESAN",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "PRIYA", lastName: "VENKATESAN", ssn: "666701008", dob: "1981-07-27", street1: "3300 N LAKE SHORE DR APT 15C", city: "CHICAGO", state: "IL", zip: "60657" },
    fraudFinderExpected: "risk.score 10 (low)",
    fraudFinderBody: { firstName: "PRIYA", lastName: "VENKATESAN", phoneNumber: "5550101008", email: "priya.venkatesan@example.com", ipAddress: "203.0.113.18", address: { addressLine1: "3300 N LAKE SHORE DR APT 15C", city: "CHICAGO", state: "IL", postalCode: "60657" } },
  },
  {
    id: "P10",
    name: "LAUREN KOWALCZYK",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "LAUREN", lastName: "KOWALCZYK", ssn: "666701010", dob: "1992-10-03", street1: "1181 WOODWARD AVE", city: "DETROIT", state: "MI", zip: "48226" },
    fraudFinderExpected: "risk.score 10 (low)",
    fraudFinderBody: { firstName: "LAUREN", lastName: "KOWALCZYK", phoneNumber: "5550101010", email: "lauren.kowalczyk@example.com", ipAddress: "203.0.113.20", address: { addressLine1: "1181 WOODWARD AVE", city: "DETROIT", state: "MI", postalCode: "48226" } },
  },
  {
    id: "P13",
    name: "KAYLA BRENNAN",
    expected: "result FAIL. SSN issue date inconsistent with DOB; multiple names linked to SSN",
    identityBody: { firstName: "KAYLA", lastName: "BRENNAN", ssn: "666701013", dob: "1999-12-24", street1: "9021 KINGSTON PIKE", city: "KNOXVILLE", state: "TN", zip: "37923" },
    fraudFinderExpected: "risk.score 88 (high), email 3 days old, phone owner no_match, voip prepaid",
    fraudFinderBody: { firstName: "KAYLA", lastName: "BRENNAN", phoneNumber: "5550101013", email: "kb.9921x@example.com", ipAddress: "198.51.100.13", address: { addressLine1: "9021 KINGSTON PIKE", city: "KNOXVILLE", state: "TN", postalCode: "37923" } },
  },
  {
    id: "P15",
    name: "NICOLE FARRAGUT",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "NICOLE", lastName: "FARRAGUT", ssn: "666701015", dob: "1983-03-30", street1: "7700 NE 72ND AVE", city: "PORTLAND", state: "OR", zip: "97218" },
    fraudFinderExpected: "risk.score 10 (low)",
    fraudFinderBody: { firstName: "NICOLE", lastName: "FARRAGUT", phoneNumber: "5550101015", email: "nicole.farragut@example.com", ipAddress: "203.0.113.25", address: { addressLine1: "7700 NE 72ND AVE", city: "PORTLAND", state: "OR", postalCode: "97218" } },
  },
  {
    id: "P17",
    name: "ELENA CASTELLANOS",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "ELENA", lastName: "CASTELLANOS", ssn: "666701017", dob: "1987-11-20", street1: "4400 N CENTRAL EXPY STE 100", city: "DALLAS", state: "TX", zip: "75206" },
    fraudFinderExpected: "risk.score 11 (low)",
    fraudFinderBody: { firstName: "ELENA", lastName: "CASTELLANOS", phoneNumber: "5550101017", email: "elena.castellanos@example.com", ipAddress: "203.0.113.27", address: { addressLine1: "4400 N CENTRAL EXPY STE 100", city: "DALLAS", state: "TX", postalCode: "75206" } },
  },
  {
    id: "P18",
    name: "TERRENCE ABERNATHY",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "TERRENCE", lastName: "ABERNATHY", ssn: "666701018", dob: "1980-02-29", street1: "2102 S HALSTED ST", city: "CHICAGO", state: "IL", zip: "60608" },
    fraudFinderExpected: "risk.score 12 (low)",
    fraudFinderBody: { firstName: "TERRENCE", lastName: "ABERNATHY", phoneNumber: "5550101018", email: "terrence.abernathy@example.com", ipAddress: "203.0.113.28", address: { addressLine1: "2102 S HALSTED ST", city: "CHICAGO", state: "IL", postalCode: "60608" } },
  },
  {
    id: "P20",
    name: "DOLORES WHITCOMB",
    expected: "result PASS. name, SSN, DOB and address all verify",
    identityBody: { firstName: "DOLORES", lastName: "WHITCOMB", ssn: "666701020", dob: "1952-05-04", street1: "612 OCEAN VIEW DR", city: "SANTA BARBARA", state: "CA", zip: "93109" },
    fraudFinderExpected: "risk.score 8 (low), landline",
    fraudFinderBody: { firstName: "DOLORES", lastName: "WHITCOMB", phoneNumber: "5550101020", email: "dolores.whitcomb@example.com", ipAddress: "203.0.113.30", address: { addressLine1: "612 OCEAN VIEW DR", city: "SANTA BARBARA", state: "CA", postalCode: "93109" } },
  },
];

/** All CRS sandbox persona SSNs follow 6667010NN. */
export const CRS_PERSONA_SSN = /^6667010\d{2}$/;

export function getCrsPersona(id: string): CrsPersona | undefined {
  return CRS_PERSONAS.find((p) => p.id === id);
}
