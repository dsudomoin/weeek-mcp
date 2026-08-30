import type { WeeekOperation } from "../openapi-types.ts";

export const WEEEK_OPENAPI_SOURCE = {
  docs: "https://developers.weeek.net/",
  specModule: "https://developers.weeek.net/assets/weeek.yaml-CByb-BPT.js",
  baseUrl: "https://api.weeek.net/public/v1",
  title: "Public API",
  version: "1.0.0",
} as const;

export const WEEEK_OPERATIONS = [
  {
    "name": "weeek_get_workspace_info",
    "method": "GET",
    "path": "/ws",
    "summary": "Get workspace info",
    "description": "Get workspace info for current token",
    "tags": [
      "Workspace"
    ],
    "parameters": []
  },
  {
    "name": "weeek_get_workspace_members",
    "method": "GET",
    "path": "/ws/members",
    "summary": "Get workspace members",
    "description": "Get workspace members for current workspace",
    "tags": [
      "Workspace"
    ],
    "parameters": []
  },
  {
    "name": "weeek_tag_list",
    "method": "GET",
    "path": "/ws/tags",
    "summary": "Tag list",
    "tags": [
      "Tags"
    ],
    "parameters": []
  },
  {
    "name": "weeek_create_tag",
    "method": "POST",
    "path": "/ws/tags",
    "summary": "Create tag",
    "tags": [
      "Tags"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string"
          }
        },
        "required": [
          "title"
        ]
      }
    }
  },
  {
    "name": "weeek_tag",
    "method": "GET",
    "path": "/ws/tags/{id}",
    "summary": "Tag",
    "tags": [
      "Tags"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "Content-Type",
        "in": "header",
        "required": false,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_tag",
    "method": "PUT",
    "path": "/ws/tags/{id}",
    "summary": "Update tag",
    "tags": [
      "Tags"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "Content-Type",
        "in": "header",
        "required": false,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string"
          },
          "color": {
            "type": "string",
            "pattern": "^#[0-9a-fA-F]{6}$"
          }
        },
        "required": [
          "title",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_tag",
    "method": "DELETE",
    "path": "/ws/tags/{id}",
    "summary": "Delete tag",
    "tags": [
      "Tags"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_get_global_custom_fields",
    "method": "GET",
    "path": "/tm/custom-fields",
    "summary": "Get global custom fields",
    "tags": [
      "Custom fields"
    ],
    "parameters": []
  },
  {
    "name": "weeek_create_global_custom_field",
    "method": "POST",
    "path": "/tm/custom-fields",
    "summary": "Create global custom field",
    "tags": [
      "Custom fields"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "type": {
            "type": "string",
            "enum": [
              "text",
              "boolean",
              "datetime",
              "select",
              "multiselect",
              "member",
              "contact",
              "link",
              "approval",
              "number"
            ]
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        },
        "required": [
          "type"
        ]
      }
    }
  },
  {
    "name": "weeek_update_global_custom_field",
    "method": "PUT",
    "path": "/tm/custom-fields/{id}",
    "summary": "Update global custom field",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_global_custom_field",
    "method": "DELETE",
    "path": "/tm/custom-fields/{id}",
    "summary": "Delete global custom field",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_transfer_global_custom_field_to_project",
    "method": "POST",
    "path": "/tm/custom-fields/{id}/transfer-to-project",
    "summary": "Transfer global custom field to project",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "integer"
          }
        },
        "required": [
          "projectId"
        ]
      }
    }
  },
  {
    "name": "weeek_transfer_global_custom_field_to_board",
    "method": "POST",
    "path": "/tm/custom-fields/{id}/transfer-to-board",
    "summary": "Transfer global custom field to board",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "boardId": {
            "type": "integer"
          }
        },
        "required": [
          "boardId"
        ]
      }
    }
  },
  {
    "name": "weeek_create_global_custom_field_option",
    "method": "POST",
    "path": "/tm/custom-fields/{custom_field_id}/options",
    "summary": "Create global custom field option",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_update_global_custom_field_option",
    "method": "PUT",
    "path": "/tm/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Update global custom field option",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_global_custom_field_option",
    "method": "DELETE",
    "path": "/tm/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Delete global custom field option",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_global_custom_field_option",
    "method": "POST",
    "path": "/tm/custom-fields/{custom_field_id}/options/{id}/move",
    "summary": "Move global custom field option",
    "tags": [
      "Custom fields"
    ],
    "parameters": [
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id after which should be moved. Cannot be provided together with before."
          },
          "before": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id before which should be moved. Cannot be provided together with after."
          }
        },
        "required": [
          "after",
          "before"
        ]
      }
    }
  },
  {
    "name": "weeek_get_portfolios",
    "method": "GET",
    "path": "/tm/portfolios",
    "summary": "Get portfolios",
    "tags": [
      "Portfolio"
    ],
    "parameters": [
      {
        "name": "search",
        "in": "query",
        "required": false,
        "description": "Search by portfolio name",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "parentId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "limit",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        }
      },
      {
        "name": "offset",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 0
        }
      }
    ]
  },
  {
    "name": "weeek_create_portfolio",
    "method": "POST",
    "path": "/tm/portfolios",
    "summary": "Create portfolio",
    "tags": [
      "Portfolio"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "parentId": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "required": [
          "name"
        ]
      }
    }
  },
  {
    "name": "weeek_get_portfolio",
    "method": "GET",
    "path": "/tm/portfolios/{id}",
    "summary": "Get portfolio",
    "tags": [
      "Portfolio"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "weeek_update_portfolio",
    "method": "PUT",
    "path": "/tm/portfolios/{id}",
    "summary": "Update portfolio",
    "tags": [
      "Portfolio"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          }
        },
        "required": [
          "name"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_portfolio",
    "method": "DELETE",
    "path": "/tm/portfolios/{id}",
    "summary": "Delete portfolio",
    "tags": [
      "Portfolio"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "weeek_get_project_list",
    "method": "GET",
    "path": "/tm/projects",
    "summary": "Get project list",
    "tags": [
      "Project"
    ],
    "parameters": []
  },
  {
    "name": "weeek_create_project",
    "method": "POST",
    "path": "/tm/projects",
    "summary": "Create project",
    "tags": [
      "Project"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "logo": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1
          },
          "isPrivate": {
            "type": "boolean",
            "description": "You must use 0 or 1 instead of false or true"
          },
          "description": {
            "type": [
              "string",
              "null"
            ]
          },
          "portfolioId": {
            "type": "integer"
          }
        },
        "required": [
          "name",
          "isPrivate"
        ]
      }
    }
  },
  {
    "name": "weeek_get_project",
    "method": "GET",
    "path": "/tm/projects/{id}",
    "summary": "Get project",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_project_info",
    "method": "PUT",
    "path": "/tm/projects/{id}",
    "summary": "Update project info",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "logo": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1
          },
          "isPrivate": {
            "type": "boolean",
            "description": "You must use 0 or 1 instead of false or true"
          },
          "color": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "name",
          "isPrivate"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_project",
    "method": "DELETE",
    "path": "/tm/projects/{id}",
    "summary": "Delete project",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_archive_project",
    "method": "POST",
    "path": "/tm/projects/{id}/archive",
    "summary": "Archive project",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "text/plain",
      "schema": {
        "type": "string"
      }
    }
  },
  {
    "name": "weeek_un_archive_project",
    "method": "POST",
    "path": "/tm/projects/{id}/un-archive",
    "summary": "Un Archive project",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "text/plain",
      "schema": {
        "type": "string"
      }
    }
  },
  {
    "name": "weeek_create_a_custom_field",
    "method": "POST",
    "path": "/tm/projects/{project_id}/custom-fields",
    "summary": "Create a custom field",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "type": {
            "type": "string",
            "enum": [
              "text",
              "boolean",
              "datetime",
              "select",
              "multiselect",
              "member",
              "contact",
              "link",
              "approval",
              "number"
            ]
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        },
        "required": [
          "type"
        ]
      }
    }
  },
  {
    "name": "weeek_update_a_custom_field",
    "method": "PUT",
    "path": "/tm/projects/{project_id}/custom-fields/{id}",
    "summary": "Update a custom field",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_a_custom_field",
    "method": "DELETE",
    "path": "/tm/projects/{project_id}/custom-fields/{id}",
    "summary": "Delete a custom field",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_transfer_custom_field_to_task_manager",
    "method": "POST",
    "path": "/tm/projects/{project_id}/custom-fields/{id}/transfer-to-task-manager",
    "summary": "Transfer custom field to task manager",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_transfer_custom_field_to_project",
    "method": "POST",
    "path": "/tm/projects/{project_id}/custom-fields/{id}/transfer-to-project",
    "summary": "Transfer custom field to project",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "integer"
          }
        },
        "required": [
          "projectId"
        ]
      }
    }
  },
  {
    "name": "weeek_transfer_custom_field_to_board",
    "method": "POST",
    "path": "/tm/projects/{project_id}/custom-fields/{id}/transfer-to-board",
    "summary": "Transfer custom field to board",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "boardId": {
            "type": "integer"
          }
        },
        "required": [
          "boardId"
        ]
      }
    }
  },
  {
    "name": "weeek_create_a_custom_field_option",
    "method": "POST",
    "path": "/tm/projects/{project_id}/custom-fields/{custom_field_id}/options",
    "summary": "Create a custom field option",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_update_a_custom_field_option",
    "method": "PUT",
    "path": "/tm/projects/{project_id}/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Update a custom field option",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_a_custom_field_option",
    "method": "DELETE",
    "path": "/tm/projects/{project_id}/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Delete a custom field option",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_a_custom_field_option",
    "method": "POST",
    "path": "/tm/projects/{project_id}/custom-fields/{custom_field_id}/options/{id}/move",
    "summary": "Move a custom field option",
    "tags": [
      "Project"
    ],
    "parameters": [
      {
        "name": "project_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id after which should be moved. Cannot be provided together with before."
          },
          "before": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id before which should be moved. Cannot be provided together with after."
          }
        },
        "required": [
          "after",
          "before"
        ]
      }
    }
  },
  {
    "name": "weeek_get_board_list",
    "method": "GET",
    "path": "/tm/boards",
    "summary": "Get board list",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "projectId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "weeek_create_board",
    "method": "POST",
    "path": "/tm/boards",
    "summary": "Create board",
    "tags": [
      "Board"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Board name"
          },
          "projectId": {
            "type": "integer",
            "description": "The project ID to which the board belongs"
          }
        },
        "required": [
          "name",
          "projectId"
        ]
      }
    }
  },
  {
    "name": "weeek_update_board",
    "method": "PUT",
    "path": "/tm/boards/{id}",
    "summary": "Update board",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "name"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_board",
    "method": "DELETE",
    "path": "/tm/boards/{id}",
    "summary": "Delete board",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_board",
    "method": "POST",
    "path": "/tm/boards/{id}/move",
    "summary": "Move board",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "upperBoardId": {
            "type": [
              "integer",
              "null"
            ],
            "description": "Board ID after which the board should be placed. If null or omitted, the board will be placed at the top"
          }
        }
      }
    }
  },
  {
    "name": "weeek_create_a_custom_field_2",
    "method": "POST",
    "path": "/tm/boards/{board_id}/custom-fields",
    "summary": "Create a custom field",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "type": {
            "type": "string",
            "enum": [
              "text",
              "boolean",
              "datetime",
              "select",
              "multiselect",
              "member",
              "contact",
              "link",
              "approval",
              "number"
            ]
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        },
        "required": [
          "type"
        ]
      }
    }
  },
  {
    "name": "weeek_update_a_custom_field_2",
    "method": "PUT",
    "path": "/tm/boards/{board_id}/custom-fields/{id}",
    "summary": "Update a custom field",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_a_custom_field_2",
    "method": "DELETE",
    "path": "/tm/boards/{board_id}/custom-fields/{id}",
    "summary": "Delete a custom field",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_transfer_custom_field_to_task_manager_2",
    "method": "POST",
    "path": "/tm/boards/{board_id}/custom-fields/{id}/transfer-to-task-manager",
    "summary": "Transfer custom field to task manager",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_transfer_custom_field_to_project_2",
    "method": "POST",
    "path": "/tm/boards/{board_id}/custom-fields/{id}/transfer-to-project",
    "summary": "Transfer custom field to project",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "integer"
          }
        },
        "required": [
          "projectId"
        ]
      }
    }
  },
  {
    "name": "weeek_transfer_custom_field_to_board_2",
    "method": "POST",
    "path": "/tm/boards/{board_id}/custom-fields/{id}/transfer-to-board",
    "summary": "Transfer custom field to board",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "boardId": {
            "type": "integer"
          }
        },
        "required": [
          "boardId"
        ]
      }
    }
  },
  {
    "name": "weeek_create_a_custom_field_option_2",
    "method": "POST",
    "path": "/tm/boards/{board_id}/custom-fields/{custom_field_id}/options",
    "summary": "Create a custom field option",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_update_a_custom_field_option_2",
    "method": "PUT",
    "path": "/tm/boards/{board_id}/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Update a custom field option",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_move_a_custom_field_option_2",
    "method": "POST",
    "path": "/tm/boards/{board_id}/custom-fields/{custom_field_id}/options/{id}/move",
    "summary": "Move a custom field option",
    "tags": [
      "Board"
    ],
    "parameters": [
      {
        "name": "board_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id after which should be moved. Cannot be provided together with before."
          },
          "before": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id before which should be moved. Cannot be provided together with after."
          }
        },
        "required": [
          "after",
          "before"
        ]
      }
    }
  },
  {
    "name": "weeek_get_board_column_list",
    "method": "GET",
    "path": "/tm/board-columns",
    "summary": "Get board column list",
    "tags": [
      "BoardColumn"
    ],
    "parameters": [
      {
        "name": "boardId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "weeek_create_board_column",
    "method": "POST",
    "path": "/tm/board-columns",
    "summary": "Create board column",
    "tags": [
      "BoardColumn"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "boardId": {
            "type": "integer"
          }
        },
        "required": [
          "name",
          "boardId"
        ]
      }
    }
  },
  {
    "name": "weeek_update_board_column",
    "method": "PUT",
    "path": "/tm/board-columns/{id}",
    "summary": "Update board column",
    "tags": [
      "BoardColumn"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "name"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_board_column",
    "method": "DELETE",
    "path": "/tm/board-columns/{id}",
    "summary": "Delete board column",
    "tags": [
      "BoardColumn"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_board_column",
    "method": "POST",
    "path": "/tm/board-columns/{id}/move",
    "summary": "Move board column",
    "tags": [
      "BoardColumn"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "upperBoardColumnId": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "required": [
          "upperBoardColumnId"
        ]
      }
    }
  },
  {
    "name": "weeek_get_tasks",
    "method": "GET",
    "path": "/tm/tasks",
    "summary": "Get tasks",
    "description": "Get tasks",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "day",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "userId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "projectId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "completed",
        "in": "query",
        "required": false,
        "description": "The parameter assumes values ​​of 0 or 1, instead of false or true",
        "schema": {
          "type": "boolean"
        }
      },
      {
        "name": "boardId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "boardColumnId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "type",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "priority",
        "in": "query",
        "required": false,
        "description": "0 - Low 1 - Medium 2 - High 3 - Hold",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "tags",
        "in": "query",
        "required": false,
        "description": "Array of tag IDs",
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      {
        "name": "search",
        "in": "query",
        "required": false,
        "description": "Search text in title and description",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "perPage",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "offset",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "sortBy",
        "in": "query",
        "required": false,
        "description": "Sorts in ascending order of the specified parameter. To sort in descending order, prepend a minus sign to the parameter, for example `-name`",
        "schema": {
          "type": "string",
          "enum": [
            "name",
            "type",
            "priority",
            "duration",
            "overdue",
            "created",
            "date",
            "start"
          ]
        }
      },
      {
        "name": "startDate",
        "in": "query",
        "required": false,
        "description": "dd.mm.yyyy Required with endDate",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "endDate",
        "in": "query",
        "required": false,
        "description": "dd.mm.yyyy Required with startDate",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "completedAtFrom",
        "in": "query",
        "required": false,
        "description": "Filter tasks completed on or after this date (dd.mm.yyyy). Only tasks with a completion date are included. Can be used without completed=true.",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "completedAtTo",
        "in": "query",
        "required": false,
        "description": "Filter tasks completed on or before this date (dd.mm.yyyy). Must be on or after completedAtFrom when both parameters are set.",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "all",
        "in": "query",
        "required": false,
        "description": "The parameter assumes values ​​of 0 or 1, instead of false or true. Shows all tasks, including deleted and completed. If present, the `completed` parameter is ignored.",
        "schema": {
          "type": "boolean"
        }
      }
    ]
  },
  {
    "name": "weeek_create_task",
    "method": "POST",
    "path": "/tm/tasks",
    "summary": "Create task",
    "tags": [
      "Task"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "description": "",
        "type": "object",
        "properties": {
          "title": {
            "type": "string"
          },
          "description": {
            "type": [
              "string",
              "null"
            ]
          },
          "day": {
            "type": [
              "string",
              "null"
            ]
          },
          "parentId": {
            "type": [
              "integer",
              "null"
            ]
          },
          "userId": {
            "type": [
              "string",
              "null"
            ]
          },
          "locations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "projectId": {
                  "type": "integer"
                },
                "boardColumnId": {
                  "type": [
                    "integer",
                    "null"
                  ]
                }
              },
              "required": [
                "projectId",
                "boardColumnId"
              ]
            }
          },
          "type": {
            "type": "string",
            "enum": [
              "action",
              "meet",
              "call"
            ]
          },
          "priority": {
            "type": [
              "integer",
              "null"
            ],
            "enum": [
              0,
              1,
              2,
              3
            ]
          },
          "customFields": {
            "type": "object",
            "properties": {},
            "description": "Key-value object with custom field id and custom field value for the task\n\nFor example\n\n```\n\"customFields\" : {\n    \"<text_custom_field_id>\": \"Text value\",\n    \"<boolean_custom_field_id>\": true,\n    \"<datetime_custom_field_id>\": \"<ISO 8601 datetime string>\",\n    \"<select_custom_field_id>\": \"<custom_field_option_id>\"\n    \"<multiselect_custom_field_id>\": [\"<custom_field_option_id>\"],\n    \"<member_custom_field_id>\": [\"<user_id>\"],\n    \"<contact_custom_field_id>\": \"<contact_id>\",\n    \"<link_custom_field_id>\": \"Link value\",\n    \"<approval_custom_field_id>\": [\"<user_id>\"]\n}\n```"
          }
        },
        "required": [
          "locations"
        ]
      }
    }
  },
  {
    "name": "weeek_get_one_task_info",
    "method": "GET",
    "path": "/tm/tasks/{id}",
    "summary": "Get one task info",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_a_task",
    "method": "PUT",
    "path": "/tm/tasks/{id}",
    "summary": "Update a task",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "priority": {
            "type": [
              "integer",
              "null"
            ],
            "enum": [
              0,
              1,
              2,
              3
            ]
          },
          "type": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "action",
              "meet",
              "call"
            ]
          },
          "startDate": {
            "type": [
              "string",
              "null"
            ],
            "description": "The start date of the task in Y-m-d format. \nCannot be provided with startDateTime or dueDateTime",
            "format": "date"
          },
          "dueDate": {
            "type": [
              "string",
              "null"
            ],
            "description": "The due date of the task in Y-m-d format. Cannot be provided with startDateTime or dueDateTime",
            "format": "date"
          },
          "startDateTime": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time",
            "title": "",
            "description": "The start datetime of the task in ISO 8601 format. Cannot be provided with startDate or dueDate"
          },
          "dueDateTime": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time",
            "title": "",
            "description": "The due datetime of the task in ISO 8601 format. Cannot be provided with startDate or dueDate"
          },
          "duration": {
            "type": [
              "integer",
              "null"
            ],
            "description": "Time estimate in minutes"
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "integer"
            },
            "description": "Array of tag ids"
          },
          "customFields": {
            "type": "object",
            "properties": {},
            "additionalProperties": false,
            "description": "Key-value object with custom field id and custom field value for the task\n\nFor example\n\n```\n\"customFields\" : {\n    \"<text_custom_field_id>\": \"Text value\",\n    \"<boolean_custom_field_id>\": true,\n    \"<datetime_custom_field_id>\": \"<ISO 8601 datetime string>\",\n    \"<select_custom_field_id>\": \"<custom_field_option_id>\"\n    \"<multiselect_custom_field_id>\": [\"<custom_field_option_id>\"],\n    \"<member_custom_field_id>\": [\"<user_id>\"],\n    \"<contact_custom_field_id>\": \"<contact_id>\",\n    \"<link_custom_field_id>\": \"Link value\",\n    \"<approval_custom_field_id>\": [\"<user_id>\"]\n}\n```"
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_task",
    "method": "DELETE",
    "path": "/tm/tasks/{id}",
    "summary": "Delete task",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_complete_task",
    "method": "POST",
    "path": "/tm/tasks/{id}/complete",
    "summary": "Complete task",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "text/plain",
      "schema": {
        "type": "string"
      }
    }
  },
  {
    "name": "weeek_un_complete_task",
    "method": "POST",
    "path": "/tm/tasks/{id}/un-complete",
    "summary": "Un complete task",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "text/plain",
      "schema": {
        "type": "string"
      }
    }
  },
  {
    "name": "weeek_change_board",
    "method": "POST",
    "path": "/tm/tasks/{id}/board",
    "summary": "Change board",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "boardId": {
            "type": "integer"
          }
        },
        "required": [
          "boardId"
        ]
      }
    }
  },
  {
    "name": "weeek_change_board_column",
    "method": "POST",
    "path": "/tm/tasks/{id}/board-column",
    "summary": "Change board column",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "boardColumnId": {
            "type": "integer"
          }
        },
        "required": [
          "boardColumnId"
        ]
      }
    }
  },
  {
    "name": "weeek_add_a_task_to_a_project",
    "method": "POST",
    "path": "/tm/tasks/{task_id}/locations",
    "summary": "Add a task to a project",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "integer"
          },
          "boardColumnId": {
            "type": [
              "integer",
              "null"
            ],
            "description": "To add task to the board column. Set null to remove from the board"
          },
          "after": {
            "type": "integer",
            "description": "Task id. To sort task in the board column"
          },
          "before": {
            "type": "integer",
            "description": "Task id. To sort task in the board column."
          }
        },
        "required": [
          "projectId"
        ]
      }
    }
  },
  {
    "name": "weeek_remove_a_task_from_a_project",
    "method": "DELETE",
    "path": "/tm/tasks/{task_id}/locations",
    "summary": "Remove a task from a project",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "integer"
          }
        },
        "required": [
          "projectId"
        ]
      }
    }
  },
  {
    "name": "weeek_upload_attachments",
    "method": "POST",
    "path": "/tm/tasks/{task_id}/attachments",
    "summary": "Upload attachments",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "multipart/form-data",
      "schema": {
        "type": "object",
        "properties": {
          "files[]": {
            "description": "Max file size is 100MB",
            "type": "string",
            "contentMediaType": "application/octet-stream"
          }
        },
        "required": [
          "files[]"
        ]
      }
    }
  },
  {
    "name": "weeek_add_watchers_to_a_task",
    "method": "POST",
    "path": "/tm/tasks/{task_id}/watchers",
    "summary": "Add watchers to a task",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "watchers": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            },
            "minItems": 1,
            "uniqueItems": true
          }
        },
        "required": [
          "watchers"
        ]
      }
    }
  },
  {
    "name": "weeek_remove_watchers_from_a_task",
    "method": "DELETE",
    "path": "/tm/tasks/{task_id}/watchers",
    "summary": "Remove watchers from a task",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "watchers": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            },
            "minItems": 1,
            "uniqueItems": true
          }
        },
        "required": [
          "watchers"
        ]
      }
    }
  },
  {
    "name": "weeek_start_task_timer",
    "method": "POST",
    "path": "/tm/tasks/{id}/start-timer",
    "summary": "Start task timer",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_stop_task_timer",
    "method": "POST",
    "path": "/tm/tasks/{id}/stop-timer",
    "summary": "Stop task timer",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_a_time_entry",
    "method": "PUT",
    "path": "/tm/tasks/{task_id}/time-entries/{time_entry_id}",
    "summary": "Update a time entry",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "time_entry_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "isOvertime": {
            "type": "boolean",
            "description": "The parameter assumes values ​​of 0 or 1, instead of false or true. A flag indicating that the entry was overtime"
          },
          "date": {
            "type": "string",
            "format": "date",
            "description": "The day of entry. In `Y-m-d` format "
          },
          "duration": {
            "type": "integer",
            "description": "Time in minutes",
            "exclusiveMinimum": 1,
            "exclusiveMaximum": 1440
          }
        },
        "required": [
          "userId",
          "isOvertime",
          "date",
          "duration"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_a_time_entry",
    "method": "DELETE",
    "path": "/tm/tasks/{task_id}/time-entries/{time_entry_id}",
    "summary": "Delete a time entry",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "time_entry_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_time_entry",
    "method": "POST",
    "path": "/tm/tasks/{task_id}/time-entries",
    "summary": "Create a time entry",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "task_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "format": "uuid"
          },
          "isOvertime": {
            "type": "boolean",
            "description": "The parameter assumes values ​​of 0 or 1, instead of false or true. A flag indicating that the entry was overtime"
          },
          "date": {
            "type": "string",
            "format": "date",
            "description": "The day of entry. In `Y-m-d` format "
          },
          "duration": {
            "type": "integer",
            "description": "Time in minutes",
            "exclusiveMinimum": 1,
            "exclusiveMaximum": 1440
          }
        },
        "required": [
          "userId",
          "isOvertime",
          "date",
          "duration"
        ]
      }
    }
  },
  {
    "name": "weeek_add_assignees",
    "method": "POST",
    "path": "/tm/tasks/{taskId}/assignees",
    "summary": "Add assignees",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "assignees": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "assignees"
        ]
      }
    }
  },
  {
    "name": "weeek_remove_assignee",
    "method": "DELETE",
    "path": "/tm/tasks/{taskId}/assignees",
    "summary": "Remove assignee",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "assignees": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "assignees"
        ]
      }
    }
  },
  {
    "name": "weeek_change_task_parent",
    "method": "POST",
    "path": "/tm/tasks/{taskId}/parent",
    "summary": "Change task parent",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "parentId": {
            "type": [
              "integer",
              "null"
            ]
          },
          "after": {
            "type": [
              "integer",
              "null"
            ]
          },
          "before": {
            "type": [
              "integer",
              "null"
            ]
          }
        },
        "required": [
          "parentId"
        ]
      }
    }
  },
  {
    "name": "weeek_get_task_comments",
    "method": "GET",
    "path": "/tm/tasks/{taskId}/comments",
    "summary": "Get task comments",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "limit",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "default": 50
        }
      },
      {
        "name": "offset",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 0,
          "default": 0
        }
      }
    ]
  },
  {
    "name": "weeek_create_task_comment",
    "method": "POST",
    "path": "/tm/tasks/{taskId}/comments",
    "summary": "Create task comment",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ],
    "requestBody": {
      "required": true,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "required": [
          "markdown"
        ],
        "properties": {
          "parentId": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1,
            "description": "Parent comment ID. The comment must exist in the current workspace and must not be deleted."
          },
          "markdown": {
            "type": "string",
            "description": "Markdown text. Attachments are not supported and cause a validation error."
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_task_comment",
    "method": "DELETE",
    "path": "/tm/tasks/{taskId}/comments/{commentId}",
    "summary": "Delete task comment",
    "tags": [
      "Task"
    ],
    "parameters": [
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "commentId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "integer"
        }
      }
    ]
  },
  {
    "name": "weeek_get_all_funnels",
    "method": "GET",
    "path": "/crm/funnels",
    "summary": "Get all funnels",
    "tags": [
      "Funnels"
    ],
    "parameters": []
  },
  {
    "name": "weeek_create_a_funnel",
    "method": "POST",
    "path": "/crm/funnels",
    "summary": "Create a funnel",
    "tags": [
      "Funnels"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "currencyId": {
            "type": "integer",
            "default": 1
          },
          "isPrivate": {
            "type": "boolean",
            "description": "You must use 0 or 1 instead of false or true"
          }
        }
      }
    }
  },
  {
    "name": "weeek_get_a_funnel",
    "method": "GET",
    "path": "/crm/funnels/{id}",
    "summary": "Get a funnel",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_a_funnel",
    "method": "PUT",
    "path": "/crm/funnels/{id}",
    "summary": "Update a funnel",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "currencyId": {
            "type": "integer",
            "default": 1
          },
          "isPrivate": {
            "type": "boolean",
            "description": "You must use 0 or 1 instead of false or true"
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_a_funnel",
    "method": "DELETE",
    "path": "/crm/funnels/{id}",
    "summary": "Delete a funnel",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_custom_field_3",
    "method": "POST",
    "path": "/crm/funnels/{funnel_id}/custom-fields",
    "summary": "Create a custom field",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "type": {
            "type": "string",
            "enum": [
              "text",
              "boolean",
              "datetime",
              "select",
              "multiselect",
              "member",
              "contact",
              "link",
              "approval",
              "number"
            ]
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        },
        "required": [
          "type"
        ]
      }
    }
  },
  {
    "name": "weeek_update_a_custom_field_3",
    "method": "PUT",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{id}",
    "summary": "Update a custom field",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "config": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "number",
                      "currency",
                      "percent"
                    ]
                  },
                  "precision": {
                    "type": [
                      "integer",
                      "null"
                    ],
                    "maximum": 6,
                    "minimum": 0
                  },
                  "currency": {
                    "type": "number",
                    "enum": [
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      7,
                      8,
                      9,
                      10
                    ],
                    "description": "Required if type = currency"
                  }
                },
                "required": [
                  "type",
                  "precision"
                ],
                "description": "Only for `number` custom fields"
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "radio",
                      "checbox"
                    ]
                  }
                },
                "required": [
                  "type"
                ],
                "description": "Only for `boolean` custom fields"
              }
            ]
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_a_custom_field_3",
    "method": "DELETE",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{id}",
    "summary": "Delete a custom field",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_a_custom_field",
    "method": "POST",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{id}/move",
    "summary": "Move a custom field",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field id after which should be moved. Cannot be provided together with before."
          },
          "before": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field id before which should be moved. Cannot be provided together with after."
          }
        },
        "required": [
          "after",
          "before"
        ]
      }
    }
  },
  {
    "name": "weeek_create_a_custom_field_option_3",
    "method": "POST",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{custom_field_id}/options",
    "summary": "Create a custom field option",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_update_a_custom_field_option_3",
    "method": "PUT",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Update a custom field option",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "color": {
            "type": "string",
            "enum": [
              "blue",
              "light_blue",
              "dark_purple",
              "purple",
              "dark_pink",
              "pink",
              "light_pink",
              "red",
              "turquoise",
              "green",
              "light_green",
              "dark_yellow",
              "yellow"
            ]
          }
        },
        "required": [
          "name",
          "color"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_a_custom_field_option_2",
    "method": "DELETE",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{custom_field_id}/options/{id}",
    "summary": "Delete a custom field option",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_a_custom_field_option_3",
    "method": "POST",
    "path": "/crm/funnels/{funnel_id}/custom-fields/{custom_field_id}/options/{id}/move",
    "summary": "Move a custom field option",
    "tags": [
      "Funnels"
    ],
    "parameters": [
      {
        "name": "funnel_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "custom_field_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id after which should be moved. Cannot be provided together with before."
          },
          "before": {
            "type": "string",
            "format": "uuid",
            "description": "An custom field option id before which should be moved. Cannot be provided together with after."
          }
        },
        "required": [
          "after",
          "before"
        ]
      }
    }
  },
  {
    "name": "weeek_get_all_funnel_statuses",
    "method": "GET",
    "path": "/crm/funnels/{funnelId}/statuses",
    "summary": "Get all funnel statuses",
    "tags": [
      "Funnel Statuses"
    ],
    "parameters": [
      {
        "name": "funnelId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_funnel_status",
    "method": "POST",
    "path": "/crm/funnels/{funnelId}/statuses",
    "summary": "Create a funnel status",
    "tags": [
      "Funnel Statuses"
    ],
    "parameters": [
      {
        "name": "funnelId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          }
        }
      }
    }
  },
  {
    "name": "weeek_get_a_funnel_status",
    "method": "GET",
    "path": "/crm/statuses/{id}",
    "summary": "Get a funnel status",
    "tags": [
      "Funnel Statuses"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_a_funnel_status",
    "method": "PUT",
    "path": "/crm/statuses/{id}",
    "summary": "Update a funnel status",
    "tags": [
      "Funnel Statuses"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_a_funnel_status",
    "method": "DELETE",
    "path": "/crm/statuses/{id}",
    "summary": "Delete a funnel status",
    "tags": [
      "Funnel Statuses"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_get_all_deals",
    "method": "GET",
    "path": "/crm/statuses/{statusId}/deals",
    "summary": "Get all deals",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "statusId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "search",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "assigneeIds",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "winStatuses",
        "in": "query",
        "required": false,
        "description": "Any value from enum: won, lost, archived",
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "lastUpdated",
        "in": "query",
        "required": false,
        "description": "Any value from enum: today, yesterday, lastWeek",
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "tags",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "organizations",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "contacts",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "customFields[*][id]",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "customFields[*][value]",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "limit",
        "in": "query",
        "required": false,
        "description": "The number of objects to return",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "offset",
        "in": "query",
        "required": false,
        "description": "The number of objects to skip",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "sort",
        "in": "query",
        "required": false,
        "description": "Sorts in ascending order of the specified parameter. To sort in descending order, prepend a minus sign to the parameter, for example `-title`",
        "schema": {
          "type": "string",
          "enum": [
            "title",
            "amount",
            "commented",
            "createdAt",
            "updatedAt"
          ]
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_deal",
    "method": "POST",
    "path": "/crm/statuses/{statusId}/deals",
    "summary": "Create a deal",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "statusId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "amount": {
            "type": [
              "number",
              "null"
            ],
            "format": "double"
          },
          "winStatus": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "won",
              "lost",
              "archived"
            ]
          },
          "description": {
            "type": [
              "string",
              "null"
            ]
          },
          "assignees": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "organizations": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "contacts": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "customFields": {
            "type": "object",
            "properties": {},
            "description": "A key-value object with custom field id as key and custom field value\n\nFor example\n\n```\n\"customFields\" : {\n    \"<text_custom_field_id>\": \"Text value\",\n    \"<boolean_custom_field_id>\": true,\n    \"<datetime_custom_field_id>\": \"<ISO 8601 datetime string>\",\n    \"<select_custom_field_id>\": \"<custom_field_option_id>\"\n    \"<multiselect_custom_field_id>\": [\"<custom_field_option_id>\"],\n    \"<member_custom_field_id>\": [\"<user_id>\"],\n    \"<contact_custom_field_id>\": \"<contact_id>\",\n    \"<link_custom_field_id>\": \"https://example.com\",\n    \"<approval_custom_field_id>\": [\"<user_id>\"]\n}\n```"
          }
        }
      }
    }
  },
  {
    "name": "weeek_get_a_deal",
    "method": "GET",
    "path": "/crm/deals/{id}",
    "summary": "Get a deal",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_a_deal",
    "method": "PUT",
    "path": "/crm/deals/{id}",
    "summary": "Update a deal",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "amount": {
            "type": [
              "number",
              "null"
            ],
            "format": "double"
          },
          "winStatus": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "won",
              "lost",
              "archived"
            ]
          },
          "customFields": {
            "type": "object",
            "properties": {},
            "description": "A key-value object with custom field id as key and custom field value\n\nFor example\n\n```\n\"customFields\" : {\n    \"<text_custom_field_id>\": \"Text value\",\n    \"<boolean_custom_field_id>\": true,\n    \"<datetime_custom_field_id>\": \"<ISO 8601 datetime string>\",\n    \"<select_custom_field_id>\": \"<custom_field_option_id>\"\n    \"<multiselect_custom_field_id>\": [\"<custom_field_option_id>\"],\n    \"<member_custom_field_id>\": [\"<user_id>\"],\n    \"<contact_custom_field_id>\": \"<contact_id>\",\n    \"<link_custom_field_id>\": \"https://example.com\",\n    \"<approval_custom_field_id>\": [\"<user_id>\"]\n}\n```"
          }
        }
      }
    }
  },
  {
    "name": "weeek_update_a_deal_fields",
    "method": "PATCH",
    "path": "/crm/deals/{id}",
    "summary": "Update a deal fields",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "amount": {
            "type": [
              "number",
              "null"
            ],
            "format": "double"
          },
          "winStatus": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "won",
              "lost",
              "archived"
            ]
          },
          "description": {
            "type": [
              "string",
              "null"
            ]
          },
          "assignees": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "organizations": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "contacts": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "customFields": {
            "type": "object",
            "properties": {},
            "description": "A key-value object with custom field id as key and custom field value\n\nFor example\n\n```\n\"customFields\" : {\n    \"<text_custom_field_id>\": \"Text value\",\n    \"<boolean_custom_field_id>\": true,\n    \"<datetime_custom_field_id>\": \"<ISO 8601 datetime string>\",\n    \"<select_custom_field_id>\": \"<custom_field_option_id>\"\n    \"<multiselect_custom_field_id>\": [\"<custom_field_option_id>\"],\n    \"<member_custom_field_id>\": [\"<user_id>\"],\n    \"<contact_custom_field_id>\": \"<contact_id>\",\n    \"<link_custom_field_id>\": \"https://example.com\",\n    \"<approval_custom_field_id>\": [\"<user_id>\"]\n}\n```"
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_a_deal",
    "method": "DELETE",
    "path": "/crm/deals/{id}",
    "summary": "Delete a deal",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_a_deal",
    "method": "POST",
    "path": "/crm/deals/{id}/move",
    "summary": "Move a deal",
    "description": "Move a deal within the funnel",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "statusId": {
            "type": [
              "string",
              "null"
            ]
          },
          "previousDealId": {
            "type": [
              "string",
              "null"
            ],
            "description": "If null, the deal will be placed at the top"
          }
        }
      }
    }
  },
  {
    "name": "weeek_update_the_deal_funnel",
    "method": "PUT",
    "path": "/crm/deals/{id}/funnel",
    "summary": "Update the deal funnel",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "funnelId": {
            "type": "string"
          }
        }
      }
    }
  },
  {
    "name": "weeek_update_the_deal_funnel_status",
    "method": "PUT",
    "path": "/crm/deals/{id}/status",
    "summary": "Update the deal funnel status",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "statusId": {
            "type": "string"
          }
        }
      }
    }
  },
  {
    "name": "weeek_attach_an_assignee",
    "method": "POST",
    "path": "/crm/deals/{dealId}/assignees",
    "summary": "Attach an assignee",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "assigneeId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "assigneeId"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_an_assignee",
    "method": "DELETE",
    "path": "/crm/deals/{dealId}/assignees",
    "summary": "Detach an assignee",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "assigneeId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "assigneeId"
        ]
      }
    }
  },
  {
    "name": "weeek_attach_a_contact",
    "method": "POST",
    "path": "/crm/deals/{dealId}/contacts",
    "summary": "Attach a contact",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "contactId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "contactId"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_a_contact",
    "method": "DELETE",
    "path": "/crm/deals/{dealId}/contacts",
    "summary": "Detach a contact",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "contactId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "contactId"
        ]
      }
    }
  },
  {
    "name": "weeek_attach_an_organization",
    "method": "POST",
    "path": "/crm/deals/{dealId}/organizations",
    "summary": "Attach an organization",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "organizationId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "organizationId"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_an_organization",
    "method": "DELETE",
    "path": "/crm/deals/{dealId}/organizations",
    "summary": "Detach an organization",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "organizationId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "organizationId"
        ]
      }
    }
  },
  {
    "name": "weeek_attach_a_tag",
    "method": "POST",
    "path": "/crm/deals/{dealId}/tags",
    "summary": "Attach a tag",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "integer"
          }
        },
        "required": [
          "tag"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_a_tag",
    "method": "DELETE",
    "path": "/crm/deals/{dealId}/tags",
    "summary": "Detach a tag",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "dealId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "integer"
          }
        },
        "required": [
          "tag"
        ]
      }
    }
  },
  {
    "name": "weeek_attach_a_new_task",
    "method": "POST",
    "path": "/crm/deals/{id}/tasks",
    "summary": "Attach a new task",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_move_a_attached_to_the_deal_task",
    "method": "POST",
    "path": "/crm/deals/{id}/tasks/{taskId}/move",
    "summary": "Move a attached to the deal task",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "previousTaskId": {
            "type": [
              "integer",
              "null"
            ],
            "description": "If null, task will be placed at the top"
          }
        }
      }
    }
  },
  {
    "name": "weeek_detach_a_task",
    "method": "DELETE",
    "path": "/crm/deals/{id}/tasks/{taskId}",
    "summary": "Detach a task",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "taskId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_upload_attachments_2",
    "method": "POST",
    "path": "/crm/deals/{deal_id}/attachments",
    "summary": "Upload attachments",
    "tags": [
      "Deals"
    ],
    "parameters": [
      {
        "name": "deal_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "multipart/form-data",
      "schema": {
        "type": "object",
        "properties": {
          "files[]": {
            "description": "Max file size is 100MB",
            "type": "string",
            "contentMediaType": "application/octet-stream"
          }
        },
        "required": [
          "files[]"
        ]
      }
    }
  },
  {
    "name": "weeek_get_all_organizations",
    "method": "GET",
    "path": "/crm/organizations",
    "summary": "Get all organizations",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "search",
        "in": "query",
        "required": false,
        "schema": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      {
        "name": "responsible",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "contacts",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "tags",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "customFields[*][id]",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "customFields[*][value]",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "limit",
        "in": "query",
        "required": false,
        "description": "The number of objects to return",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "offset",
        "in": "query",
        "required": false,
        "description": "The number of objects to skip",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "sort",
        "in": "query",
        "required": false,
        "description": "Sorts in ascending order of the specified parameter. To sort in descending order, prepend a minus sign to the parameter, for example `-alphabet`",
        "schema": {
          "type": "string",
          "enum": [
            "alphabet",
            "updatedAt"
          ]
        }
      }
    ]
  },
  {
    "name": "weeek_create_an_organization",
    "method": "POST",
    "path": "/crm/organizations",
    "summary": "Create an organization",
    "tags": [
      "Organizations"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "addresses": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 255
            }
          },
          "emails": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "email",
              "maxLength": 255
            }
          },
          "phones": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 255
            }
          },
          "responsibles": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          }
        }
      }
    }
  },
  {
    "name": "weeek_get_an_organization",
    "method": "GET",
    "path": "/crm/organizations/{id}",
    "summary": "Get an organization",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_an_organization",
    "method": "PUT",
    "path": "/crm/organizations/{id}",
    "summary": "Update an organization",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 255
          },
          "addresses": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 255
            }
          },
          "emails": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "email",
              "maxLength": 255
            }
          },
          "phones": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 255
            }
          },
          "responsibles": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uuid"
            }
          }
        }
      }
    }
  },
  {
    "name": "weeek_delete_an_organization",
    "method": "DELETE",
    "path": "/crm/organizations/{id}",
    "summary": "Delete an organization",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_an_address",
    "method": "POST",
    "path": "/crm/organizations/{organizationId}/addresses",
    "summary": "Create an address",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "address": {
            "type": "string",
            "maxLength": 255
          }
        },
        "required": [
          "address"
        ]
      }
    }
  },
  {
    "name": "weeek_update_the_address",
    "method": "PUT",
    "path": "/crm/organizations/{organizationId}/addresses/{addressId}",
    "summary": "Update the address",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "addressId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "address": {
            "type": "string",
            "maxLength": 255
          }
        },
        "required": [
          "address"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_the_address",
    "method": "DELETE",
    "path": "/crm/organizations/{organizationId}/addresses/{addressId}",
    "summary": "Delete the address",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "addressId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_an_email",
    "method": "POST",
    "path": "/crm/organizations/{organizationId}/emails",
    "summary": "Create an email",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 255,
            "format": "email"
          }
        },
        "required": [
          "email"
        ]
      }
    }
  },
  {
    "name": "weeek_update_the_email",
    "method": "PUT",
    "path": "/crm/organizations/{organizationId}/emails/{emailId}",
    "summary": "Update the email",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "emailId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 255,
            "format": "email"
          }
        },
        "required": [
          "email"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_the_email",
    "method": "DELETE",
    "path": "/crm/organizations/{organizationId}/emails/{emailId}",
    "summary": "Delete the email",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "emailId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_phone",
    "method": "POST",
    "path": "/crm/organizations/{organizationId}/phones",
    "summary": "Create a phone",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "phone": {
            "type": "string",
            "maxLength": 255
          }
        },
        "required": [
          "phone"
        ]
      }
    }
  },
  {
    "name": "weeek_update_the_phone",
    "method": "PUT",
    "path": "/crm/organizations/{organizationId}/phones/{phoneId}",
    "summary": "Update the phone",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "phoneId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "phone": {
            "type": "string",
            "maxLength": 255
          }
        },
        "required": [
          "phone"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_the_phone",
    "method": "DELETE",
    "path": "/crm/organizations/{organizationId}/phones/{phoneId}",
    "summary": "Delete the phone",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "phoneId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_attach_a_contact_2",
    "method": "POST",
    "path": "/crm/organizations/{organizationId}/contacts",
    "summary": "Attach a contact",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "contactId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "contactId"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_the_contact",
    "method": "DELETE",
    "path": "/crm/organizations/{organizationId}/contacts",
    "summary": "Detach the contact",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "contactId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "contactId"
        ]
      }
    }
  },
  {
    "name": "weeek_attach_a_tag_2",
    "method": "POST",
    "path": "/crm/organizations/{organizationId}/tags",
    "summary": "Attach a tag",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "tagId": {
            "type": "integer"
          }
        },
        "required": [
          "tagId"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_the_tag",
    "method": "DELETE",
    "path": "/crm/organizations/{organizationId}/tags",
    "summary": "Detach the tag",
    "tags": [
      "Organizations"
    ],
    "parameters": [
      {
        "name": "organizationId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "tagId": {
            "type": "integer"
          }
        },
        "required": [
          "tagId"
        ]
      }
    }
  },
  {
    "name": "weeek_get_all_currencies",
    "method": "GET",
    "path": "/crm/currencies",
    "summary": "Get all currencies",
    "tags": [
      "Currencies"
    ],
    "parameters": []
  },
  {
    "name": "weeek_get_all_contacts",
    "method": "GET",
    "path": "/crm/contacts",
    "summary": "Get all contacts",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "search",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "organizationIds",
        "in": "query",
        "required": false,
        "schema": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      },
      {
        "name": "customFields[*][id]",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "customFields[*][value]",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "limit",
        "in": "query",
        "required": false,
        "description": "The number of objects to return",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "offset",
        "in": "query",
        "required": false,
        "description": "The number of objects to skip",
        "schema": {
          "type": "integer"
        }
      },
      {
        "name": "sort",
        "in": "query",
        "required": false,
        "description": "Sorts in ascending order of the specified parameter. To sort in descending order, prepend a minus sign to the parameter, for example `-alphabet`",
        "schema": {
          "type": "string",
          "enum": [
            "alphabet",
            "updatedAt"
          ]
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_contact",
    "method": "POST",
    "path": "/crm/contacts",
    "summary": "Create a contact",
    "tags": [
      "Contacts"
    ],
    "parameters": [],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "lastName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "firstName": {
            "type": "string",
            "maxLength": 255
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "organizations": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "emails": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "format": "email",
              "maxLength": 255
            }
          },
          "phones": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "maxLength": 255
            }
          },
          "tags": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "integer"
            }
          }
        },
        "required": [
          "firstName"
        ]
      }
    }
  },
  {
    "name": "weeek_get_a_contact",
    "method": "GET",
    "path": "/crm/contacts/{id}",
    "summary": "Get a contact",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_update_a_contact",
    "method": "PUT",
    "path": "/crm/contacts/{id}",
    "summary": "Update a contact",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "lastName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "firstName": {
            "type": "string",
            "maxLength": 255
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "organizations": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "format": "uuid"
            }
          },
          "emails": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "format": "email",
              "maxLength": 255
            }
          },
          "phones": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "maxLength": 255
            }
          },
          "tags": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "integer"
            }
          }
        },
        "required": [
          "firstName"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_a_contact",
    "method": "DELETE",
    "path": "/crm/contacts/{id}",
    "summary": "Delete a contact",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_an_email_2",
    "method": "POST",
    "path": "/crm/contacts/{contactId}/emails",
    "summary": "Create an email",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 255,
            "format": "email"
          }
        },
        "required": [
          "email"
        ]
      }
    }
  },
  {
    "name": "weeek_update_the_email_2",
    "method": "PUT",
    "path": "/crm/contacts/{contactId}/emails/{emailId}",
    "summary": "Update the email",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "emailId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "maxLength": 255,
            "format": "email"
          }
        },
        "required": [
          "email"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_the_email_2",
    "method": "DELETE",
    "path": "/crm/contacts/{contactId}/emails/{emailId}",
    "summary": "Delete the email",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "emailId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_create_a_phone_2",
    "method": "POST",
    "path": "/crm/contacts/{contactsId}/phones",
    "summary": "Create a phone",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactsId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "phone": {
            "type": "string",
            "maxLength": 255
          }
        },
        "required": [
          "phone"
        ]
      }
    }
  },
  {
    "name": "weeek_update_the_phone_2",
    "method": "PUT",
    "path": "/crm/contacts/{contactsId}/phones/{phoneId}",
    "summary": "Update the phone",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactsId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "phoneId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "phone": {
            "type": "string",
            "maxLength": 255
          }
        },
        "required": [
          "phone"
        ]
      }
    }
  },
  {
    "name": "weeek_delete_the_phone_2",
    "method": "DELETE",
    "path": "/crm/contacts/{contactsId}/phones/{phoneId}",
    "summary": "Delete the phone",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactsId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "phoneId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  {
    "name": "weeek_attach_a_tag_3",
    "method": "POST",
    "path": "/crm/contacts/{contactId}/tags",
    "summary": "Attach a tag",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "tagId": {
            "type": "integer"
          }
        },
        "required": [
          "tagId"
        ]
      }
    }
  },
  {
    "name": "weeek_detach_the_tag_2",
    "method": "DELETE",
    "path": "/crm/contacts/{contactId}/tags",
    "summary": "Detach the tag",
    "tags": [
      "Contacts"
    ],
    "parameters": [
      {
        "name": "contactId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "requestBody": {
      "required": false,
      "contentType": "application/json",
      "schema": {
        "type": "object",
        "properties": {
          "tagId": {
            "type": "integer"
          }
        },
        "required": [
          "tagId"
        ]
      }
    }
  },
  {
    "name": "weeek_get_profile",
    "method": "GET",
    "path": "/user/me",
    "summary": "Get profile",
    "tags": [
      "User"
    ],
    "parameters": []
  },
  {
    "name": "weeek_get_an_attachment",
    "method": "GET",
    "path": "/ws/attachments/{file_id}",
    "summary": "Get an attachment",
    "tags": [
      "Attachments"
    ],
    "parameters": [
      {
        "name": "file_id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ]
  }
] as const satisfies readonly WeeekOperation[];
