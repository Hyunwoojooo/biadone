#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int has_health_method(const char *line) {
    const char *method = strstr(line, "\"method\"");
    if (method == NULL) {
        return 0;
    }

    const char *value = strchr(method + strlen("\"method\""), ':');
    if (value == NULL) {
        return 0;
    }

    value += 1;
    while (isspace((unsigned char)*value)) {
        value += 1;
    }

    return strncmp(value, "\"health\"", strlen("\"health\"")) == 0;
}

int main(void) {
    char *line = NULL;
    size_t capacity = 0;

    while (getline(&line, &capacity, stdin) != -1) {
        if (has_health_method(line)) {
            puts("{\"ok\":true,\"runtime\":\"c\",\"protocol_version\":1}");
        } else if (strchr(line, '{') == NULL) {
            puts("{\"ok\":false,\"error\":\"invalid_json\",\"protocol_version\":1}");
        } else {
            puts("{\"ok\":false,\"error\":\"unsupported_method\",\"protocol_version\":1}");
        }
        fflush(stdout);
    }

    free(line);
    return 0;
}
