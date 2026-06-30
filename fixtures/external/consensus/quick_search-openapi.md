# Consensus REST `/v1/quick_search` OpenAPI Excerpt

Source fetched: https://docs.consensus.app/reference/v1_quick_search.md

## Server and Auth

- OpenAPI: `3.1.0`
- Server URL: `https://api.consensus.app`
- Path: `GET /v1/quick_search`
- Security scheme: `XApiKeyHeader`
- Auth header: `x-api-key`

```json
"securitySchemes": {
  "XApiKeyHeader": {
    "in": "header",
    "name": "x-api-key",
    "type": "apiKey"
  }
}
```

## Request Query Parameters

```json
[
  {
    "name": "query",
    "in": "query",
    "required": true,
    "schema": {
      "title": "Query",
      "type": "string"
    },
    "description": "Query for research papers."
  },
  {
    "name": "year_min",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Year Min",
      "type": "integer"
    },
    "description": "Exclude papers before this year."
  },
  {
    "name": "year_max",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Year Max",
      "type": "integer"
    },
    "description": "Exclude papers after this year."
  },
  {
    "name": "study_types",
    "in": "query",
    "required": false,
    "schema": {
      "default": [],
      "items": {
        "$ref": "#/components/schemas/StudyTypeKeywordEnum"
      },
      "type": "array"
    },
    "description": "Only include these study types."
  },
  {
    "name": "human",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Human",
      "type": "boolean"
    },
    "description": "Only include human studies."
  },
  {
    "name": "sample_size_min",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Sample Size Min",
      "type": "integer"
    },
    "description": "Exclude studies with smaller sample sizes."
  },
  {
    "name": "sjr_max",
    "in": "query",
    "required": false,
    "schema": {
      "maximum": 4,
      "minimum": 1,
      "title": "Sjr Max",
      "type": "integer"
    },
    "description": "Exclude journals in lesser quartiles, where 1 is the best quartile."
  },
  {
    "name": "duration_min",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Duration Min",
      "type": "integer"
    },
    "description": "Minimum study duration (in days)."
  },
  {
    "name": "duration_max",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Duration Max",
      "type": "integer"
    },
    "description": "Maximum study duration (in days)."
  },
  {
    "name": "exclude_preprints",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Exclude Preprints",
      "type": "boolean"
    },
    "description": "Exclude preprints, only include peer-reviewed papers."
  },
  {
    "name": "medical_mode",
    "in": "query",
    "required": false,
    "schema": {
      "title": "Medical Mode",
      "type": "boolean"
    },
    "description": "Filter to top medical journals and guidelines, about 8M documents"
  }
]
```

## Response Schema

Top-level shape:

```json
{
  "results": [
    "QueryResult"
  ]
}
```

`QuickSearchResponse`:

```json
{
  "properties": {
    "results": {
      "description": "List of query results.",
      "items": {
        "$ref": "#/components/schemas/QueryResult"
      },
      "title": "Results",
      "type": "array"
    }
  },
  "required": [
    "results"
  ],
  "title": "QuickSearchResponse",
  "type": "object"
}
```

`QueryResult` properties:

```json
{
  "abstract": {
    "description": "Abstract of the paper.",
    "type": "string"
  },
  "authors": {
    "description": "List of the paper's authors.",
    "items": {
      "type": "string"
    },
    "type": "array"
  },
  "doi": {
    "description": "Digital Object Identifier for the document.",
    "type": "string"
  },
  "journal_name": {
    "description": "Publication journal of the paper.",
    "type": "string"
  },
  "pages": {
    "description": "Page range of the paper.",
    "type": "string"
  },
  "publish_year": {
    "description": "Publication year of the paper.",
    "type": "integer"
  },
  "title": {
    "description": "Title of the paper.",
    "type": "string"
  },
  "url": {
    "description": "Consensus URL for more paper details.",
    "type": "string"
  },
  "volume": {
    "description": "Journal volume of the paper.",
    "type": "string"
  },
  "citation_count": {
    "description": "Number of citations for the paper.",
    "type": "integer"
  },
  "study_type": {
    "description": "Study type of the paper.",
    "type": "string"
  },
  "takeaway": {
    "description": "Key takeaway or summary from the paper abstract.",
    "type": "string"
  }
}
```

Required `QueryResult` fields:

```json
[
  "abstract",
  "authors",
  "doi",
  "journal_name",
  "pages",
  "publish_year",
  "title",
  "url",
  "volume",
  "citation_count"
]
```

Study type enum:

```json
[
  "case report",
  "literature review",
  "meta-analysis",
  "non-rct experimental",
  "non-rct in vitro",
  "non-rct observational study",
  "rct",
  "systematic review",
  "animal"
]
```
