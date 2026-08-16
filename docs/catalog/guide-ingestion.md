---
id: guide-ingestion
name: Guide ingestion service
area: designer
status: shipped
version: baseline
depends: [guide-lifecycle]
terms: [AR Work Instructions, SIB]
spec: PROCEDURE-DESIGNER.md
---
One create/upsert path shared by JSON import, xlsx import and procedure export
(`sib/src/guides/ingest.ts`). Its tested invariant is the platform's most important
promise to authors: spatial placement can never be overwritten by an import or a
canvas write.
