package com.prince.personalaiagent

import android.content.ComponentName
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ReminderDeliveryStoreTest {
    private val context =
        InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun immediateWorkerTriggerIsDebugOnlyAndShellRestricted() {
        val receiver = context.packageManager.getReceiverInfo(
            ComponentName(context, DebugReminderWorkerTriggerReceiver::class.java),
            0
        )

        assertTrue(receiver.exported)
        assertEquals("android.permission.DUMP", receiver.permission)
    }

    @Test
    fun deliversReminderOnlyOnceAcrossRepeatedChecks() {
        val reminderId = UUID.randomUUID().toString()
        var deliveryCount = 0

        assertTrue(
            ReminderDeliveryStore.deliverOnce(context, reminderId) {
                deliveryCount += 1
            }
        )
        assertFalse(
            ReminderDeliveryStore.deliverOnce(context, reminderId) {
                deliveryCount += 1
            }
        )

        assertEquals(1, deliveryCount)
    }

    @Test
    fun failedDeliveryDoesNotMarkReminderAsDelivered() {
        val reminderId = UUID.randomUUID().toString()
        var deliveryCount = 0

        try {
            ReminderDeliveryStore.deliverOnce(context, reminderId) {
                deliveryCount += 1
                throw IllegalStateException("Notification could not be posted.")
            }
        } catch (_: IllegalStateException) {
            // A failed post must remain retryable.
        }

        assertTrue(
            ReminderDeliveryStore.deliverOnce(context, reminderId) {
                deliveryCount += 1
            }
        )
        assertEquals(2, deliveryCount)
    }

    @Test
    fun inAppDisplayStatePersistsAcrossRepeatedChecks() {
        val reminderId = UUID.randomUUID().toString()

        assertFalse(
            ReminderDeliveryStore.wasDisplayedInApp(context, reminderId)
        )
        ReminderDeliveryStore.markDisplayedInApp(context, reminderId)
        assertTrue(
            ReminderDeliveryStore.wasDisplayedInApp(context, reminderId)
        )
    }
}
