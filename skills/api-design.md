# API Design Standards

## Principles
- RESTful
- Stateless
- JSON only
- Use schemas from /docs/schemas.md

## Endpoints (Phase 1)
- POST /anchors
- POST /tags
- POST /sessions
- POST /perception/analyze-image

## Responses
- Always return `id`
- Always return timestamps
- Always return normalized data
