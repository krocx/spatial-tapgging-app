
---

# 📄 **`/docs/perception-framework.md`**

```markdown
# Perception Adapter Framework

## Purpose
Provide a unified interface for integrating multiple AI models:
- Sodavision
- Neurocle
- Python classifiers
- Foundation models

## Responsibilities
- Normalize labels → SIB ontology
- Map bounding boxes → pixel coords
- Map confidence → unified scale
- Return `Observation[]`
- Preserve raw model output in `rawPayload`

## Adapter Interface (TypeScript)
```ts
export interface PerceptionAdapter {
  analyze(image: Buffer, context: any): Promise<Observation[]>;
}
