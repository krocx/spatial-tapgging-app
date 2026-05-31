# SIB Schemas (v1.0)

## Anchor
## json
{
  "id": "string",
  "assetId": "string",
  "coordinateSystem": "ASSET_FRAME",
  "position": { "x": 0, "y": 0, "z": 0 },
  "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
  "metadata": {}
}
## Tag
## json
{
  "id": "string",
  "anchorId": "string",
  "type": "INSPECTION_POINT",
  "label": "string",
  "expectedOutcome": "string",
  "metadata": {}
}
## Observation
## json
{
  "id": "string",
  "source": "string",
  "timestamp": "ISO8601",
  "imageId": "string",
  "assetId": "string",
  "anchorId": "string",
  "tagId": "string",
  "label": "string",
  "confidence": 0.0,
  "severity": "LOW|MEDIUM|HIGH",
  "location": {},
  "rawPayload": {}
}
## Procedure
## json
{
  "id": "string",
  "assetId": "string",
  "name": "string",
  "steps": []
}
## Session
## json
{
  "id": "string",
  "userId": "string",
  "assetId": "string",
  "startTime": "ISO8601",
  "endTime": "ISO8601",
  "observations": [],
  "completedSteps": []
}