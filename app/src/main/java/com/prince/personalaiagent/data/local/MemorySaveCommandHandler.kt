package com.prince.personalaiagent.data.local

import kotlinx.coroutines.flow.first

internal sealed class MemorySaveCommandResult {
    data class Saved(
        val memoryId: Long,
        val content: String
    ) : MemorySaveCommandResult()

    data object MissingContent : MemorySaveCommandResult()

    data class UnsupportedIntent(
        val message: String
    ) : MemorySaveCommandResult()

    data class Failed(
        val message: String
    ) : MemorySaveCommandResult()
}

internal object MemorySaveCommandHandler {
    private val savePrefixes = listOf(
        "please remember that ",
        "can you remember that ",
        "could you remember that ",
        "i want you to remember that ",
        "i'd like you to remember that ",
        "remember that ",
        "remember this: ",
        "remember this ",
        "remember my ",
        "remember i am ",
        "remember i'm ",
        "remember ",
        "memorize that ",
        "memorise that ",
        "memorize this: ",
        "memorise this: ",
        "memorize this ",
        "memorise this ",
        "memorize it: ",
        "memorise it: ",
        "memorize it ",
        "memorise it ",
        "memorize ",
        "memorise ",
        "save this to memory: ",
        "save this to memory ",
        "save this information: ",
        "save this information ",
        "save this: ",
        "save this ",
        "save that ",
        "please save that ",
        "please save this ",
        "keep in mind that ",
        "keep in mind ",
        "don't forget that ",
        "dont forget that ",
        "do not forget that ",
        "make a note that ",
        "make a note of ",
        "note that "
    )

    private val memorySaveIntent = Regex(
        """^(?:(?:please|kindly)\s+|(?:can|could|would)\s+you\s+|i(?:'d| would) like you to\s+|i want you to\s+)?(?:remember|memorize|memorise|save(?:\s+(?:this|that|my|it|to memory))?|store(?:\s+(?:this|that|it|my|to memory))?|keep\s+in\s+mind|make\s+a\s+note)\b""",
        RegexOption.IGNORE_CASE
    )

    suspend fun handle(
        message: String,
        memoryRepository: MemoryRepository
    ): MemorySaveCommandResult? {
        val cleanedMessage = message.trim()
        val matchedPrefix = savePrefixes.firstOrNull {
            cleanedMessage.startsWith(it, ignoreCase = true)
        }

        if (matchedPrefix == null) {
            val isEmptySaveRequest = savePrefixes.any {
                cleanedMessage.equals(it.trimEnd(), ignoreCase = true)
            }
            if (isEmptySaveRequest) {
                return MemorySaveCommandResult.MissingContent
            }

            return if (memorySaveIntent.containsMatchIn(cleanedMessage)) {
                MemorySaveCommandResult.UnsupportedIntent(
                    "I couldn't safely save that request. Please start it with " +
                        "\"Remember that\" so I can save it on this device."
                )
            } else {
                null
            }
        }

        val content = cleanedMessage
            .drop(matchedPrefix.length)
            .trim()
            .trimEnd('.', '!', '?', ',')
        if (content.isBlank()) {
            return MemorySaveCommandResult.MissingContent
        }

        val memoryId = memoryRepository.saveMemory(content)
        if (memoryId <= 0L) {
            return MemorySaveCommandResult.Failed(
                "The memory database did not confirm the save."
            )
        }

        val wasPersisted = memoryRepository.getAllMemories()
            .first()
            .any { it.id.toLong() == memoryId }
        if (!wasPersisted) {
            return MemorySaveCommandResult.Failed(
                "The memory was not found after the save operation."
            )
        }

        return MemorySaveCommandResult.Saved(memoryId, content)
    }
}
