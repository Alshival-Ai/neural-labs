"""Scope Snap Docker management permissions to the native workspace profile.

Pure transformation, never invoked implicitly by repository validation. The
host installer must validate, back up and load the result as an explicit host
operation, and reapply after Snap regenerates its daemon policy. Container and
host kernel restrictions are unchanged.
"""

BEGIN = "  # BEGIN Neural Labs native container management v1\n"
END = "  # END Neural Labs native container management v1\n"
BLOCK = BEGIN + """  signal (send) peer=neural-labs-native-v1,
  ptrace (read,trace) peer=neural-labs-native-v1,
""" + END


def with_native_management(source: str) -> str:
    if 'profile "snap.docker.dockerd"' not in source or not source.rstrip().endswith("}"):
        raise ValueError("Expected the confined Snap Docker daemon profile")
    if BEGIN in source or END in source:
        if source.count(BLOCK) != 1 or source.count(BEGIN) != 1 or source.count(END) != 1:
            raise ValueError("Native profile permissions have changed; review before replacing")
        return source
    boundary = source.rfind("}")
    return source[:boundary] + BLOCK + source[boundary:]
