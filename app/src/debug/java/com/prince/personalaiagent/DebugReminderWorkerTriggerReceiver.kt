package com.prince.personalaiagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager

class DebugReminderWorkerTriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_TRIGGER) return

        val request = OneTimeWorkRequestBuilder<ReminderDeliveryWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()

        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        Log.i(TAG, "Debug reminder worker trigger enqueued.")
    }

    companion object {
        const val ACTION_TRIGGER =
            "com.prince.personalaiagent.DEBUG_TRIGGER_REMINDER_WORKER"

        private const val WORK_NAME = "debug-reminder-delivery"
        private const val TAG = "ReminderDelivery"
    }
}
