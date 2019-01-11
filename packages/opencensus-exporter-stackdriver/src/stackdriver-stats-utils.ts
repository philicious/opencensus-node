/**
 * Copyright 2019, OpenCensus Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {BucketOptions, DistributionBucket, DistributionValue, LabelKey, LabelValue, Metric, MetricDescriptor as OCMetricDescriptor, MetricDescriptorType, TimeSeriesPoint, Timestamp} from '@opencensus/core';
import * as os from 'os';
import * as path from 'path';

import {Distribution, LabelDescriptor, MetricDescriptor, MetricKind, MonitoredResource, Point, TimeSeries, ValueType} from './types';

const OPENCENSUS_TASK = 'opencensus_task';
const OPENCENSUS_TASK_DESCRIPTION = 'Opencensus task identifier';
export const OPENCENSUS_TASK_VALUE_DEFAULT = generateDefaultTaskValue();

/** Converts a OpenCensus MetricDescriptor to a StackDriver MetricDescriptor. */
export function createMetricDescriptorData(
    metricDescriptor: OCMetricDescriptor, metricPrefix: string,
    displayNamePrefix: string): MetricDescriptor {
  return {
    type: getMetricType(metricDescriptor.name, metricPrefix),
    description: metricDescriptor.description,
    displayName: createDisplayName(metricDescriptor.name, displayNamePrefix),
    metricKind: createMetricKind(metricDescriptor.type),
    valueType: createValueType(metricDescriptor.type),
    unit: metricDescriptor.unit,
    labels: createLabelDescriptor(metricDescriptor.labelKeys)
  };
}

/**
 * Converts metric's timeseries to a list of TimeSeries, so that metric can be
 * uploaded to StackDriver.
 */
export function createTimeSeriesList(
    metric: Metric, monitoredResource: MonitoredResource,
    metricPrefix: string): TimeSeries[] {
  const timeSeriesList: TimeSeries[] = [];

  // TODO(mayurkale): Use Resource API here, once available (PR#173)
  const metricDescriptor = metric.descriptor;
  const metricKind = createMetricKind(metricDescriptor.type);
  const valueType = createValueType(metricDescriptor.type);

  for (const timeSeries of metric.timeseries) {
    timeSeriesList.push({
      metric:
          createMetric(metricDescriptor, timeSeries.labelValues, metricPrefix),
      resource: monitoredResource,
      metricKind,
      valueType,
      points: timeSeries.points.map(point => {
        return createPoint(point, timeSeries.startTimestamp, valueType);
      })
    });
  }
  return timeSeriesList;
}

/** Creates Metric type. */
export function getMetricType(name: string, metricPrefix: string): string {
  return path.join(metricPrefix, name);
}

/** Creates Metric display name. */
export function createDisplayName(
    name: string, displayNamePrefix: string): string {
  return path.join(displayNamePrefix, name);
}

/** Converts a OpenCensus Type to a StackDriver MetricKind. */
export function createMetricKind(metricDescriptorType: MetricDescriptorType):
    MetricKind {
  if (metricDescriptorType === MetricDescriptorType.GAUGE_INT64 ||
      metricDescriptorType === MetricDescriptorType.GAUGE_DOUBLE) {
    return MetricKind.GAUGE;
  } else if (
      metricDescriptorType === MetricDescriptorType.CUMULATIVE_INT64 ||
      metricDescriptorType === MetricDescriptorType.CUMULATIVE_DOUBLE ||
      metricDescriptorType === MetricDescriptorType.CUMULATIVE_DISTRIBUTION) {
    return MetricKind.CUMULATIVE;
  }
  return MetricKind.UNSPECIFIED;
}

/** Converts a OpenCensus Type to a StackDriver ValueType. */
export function createValueType(metricDescriptorType: MetricDescriptorType):
    ValueType {
  if (metricDescriptorType === MetricDescriptorType.CUMULATIVE_DOUBLE ||
      metricDescriptorType === MetricDescriptorType.GAUGE_DOUBLE) {
    return ValueType.DOUBLE;
  } else if (
      metricDescriptorType === MetricDescriptorType.GAUGE_INT64 ||
      metricDescriptorType === MetricDescriptorType.CUMULATIVE_INT64) {
    return ValueType.INT64;
  } else if (
      metricDescriptorType === MetricDescriptorType.GAUGE_DISTRIBUTION ||
      metricDescriptorType === MetricDescriptorType.CUMULATIVE_DISTRIBUTION) {
    return ValueType.DISTRIBUTION;
  } else {
    return ValueType.VALUE_TYPE_UNSPECIFIED;
  }
}

/** Constructs a LabelDescriptor from a LabelKey. */
export function createLabelDescriptor(labelKeys: LabelKey[]):
    LabelDescriptor[] {
  const labelDescriptorList: LabelDescriptor[] =
      labelKeys.map(labelKey => ({
                      key: labelKey.key,
                      valueType: 'STRING',  // Now we only support String type.
                      description: labelKey.description
                    }));

  // add default "opencensus_task" label.
  labelDescriptorList.push({
    key: OPENCENSUS_TASK,
    valueType: 'STRING',
    description: OPENCENSUS_TASK_DESCRIPTION
  });
  return labelDescriptorList;
}

/** Creates a Metric using the LabelKeys and LabelValues. */
export function createMetric(
    metricDescriptor: OCMetricDescriptor, labelValues: LabelValue[],
    metricPrefix: string): {type: string; labels: {[key: string]: string};} {
  const type = getMetricType(metricDescriptor.name, metricPrefix);
  const labels: {[key: string]: string} = {};
  for (let i = 0; i < labelValues.length; i++) {
    const value = labelValues[i].value;
    if (value && metricDescriptor.labelKeys[i]) {
      labels[metricDescriptor.labelKeys[i].key] = value;
    } else {
      // TODO(mayurkale) : consider to throw an error when LabelValue and
      // LabelKey lengths are not same.
    }
  }
  labels[OPENCENSUS_TASK] = OPENCENSUS_TASK_VALUE_DEFAULT;
  return {type, labels};
}

/**
 * Converts timeseries's point, so that metric can be uploaded to StackDriver.
 */
export function createPoint(
    point: TimeSeriesPoint, startTimeStamp: Timestamp,
    valueType: ValueType): Point {
  const value = createValue(valueType, point);
  const endTime = toISOString(point.timestamp);
  if (startTimeStamp) {
    // Must be present for cumulative metrics.
    const startTime = toISOString(startTimeStamp);
    return {interval: {startTime, endTime}, value};
  }
  return {interval: {endTime}, value};
}

/** Converts a OpenCensus Point's value to a StackDriver Point value. */
export function createValue(valueType: ValueType, point: TimeSeriesPoint) {
  if (valueType === ValueType.INT64) {
    return {int64Value: point.value as number};
  } else if (valueType === ValueType.DOUBLE) {
    return {doubleValue: point.value as number};
  } else if (valueType === ValueType.DISTRIBUTION) {
    return {
      distributionValue: createDistribution(point.value as DistributionValue)
    };
  }
  throw Error(`unsupported value type: ${valueType}`);
}

/** Formats an OpenCensus Distribution to Stackdriver's format. */
export function createDistribution(distribution: DistributionValue):
    Distribution {
  return {
    count: distribution.count,
    mean: distribution.count === 0 ? 0 : distribution.sum / distribution.count,
    sumOfSquaredDeviation: distribution.sumOfSquaredDeviation,
    bucketOptions: {
      explicitBuckets:
          {bounds: createExplicitBucketOptions(distribution.bucketOptions)}
    },
    bucketCounts: createBucketCounts(distribution.buckets)
  };
}

/** Converts a OpenCensus BucketOptions to a StackDriver BucketOptions. */
export function createExplicitBucketOptions(bucketOptions: BucketOptions):
    number[] {
  const explicitBucketOptions: number[] = [];
  // The first bucket bound should be 0.0 because the Metrics first bucket is
  // [0, first_bound) but Stackdriver monitoring bucket bounds begin with
  // -infinity (first bucket is (-infinity, 0))
  explicitBucketOptions.push(0);
  return explicitBucketOptions.concat(bucketOptions.explicit.bounds);
}

/** Converts a OpenCensus Buckets to a list of counts. */
export function createBucketCounts(buckets: DistributionBucket[]): number[] {
  const bucketCounts: number[] = [];
  // The first bucket (underflow bucket) should always be 0 count because the
  // Metrics first bucket is [0, first_bound) but StackDriver distribution
  // consists of an underflow bucket (number 0).
  bucketCounts.push(0);
  buckets.map((bucket: DistributionBucket) => {
    bucketCounts.push(bucket.count);
  });
  return bucketCounts;
}

/** Returns a task label value in the format of 'nodejs-<pid>@<hostname>'. */
function generateDefaultTaskValue(): string {
  const pid = process.pid;
  const hostname = os.hostname() || 'localhost';
  return 'nodejs-' + pid + '@' + hostname;
}

function toISOString(timestamp: Timestamp) {
  const str = new Date(timestamp.seconds * 1000).toISOString();
  const nsStr = `${leftZeroPad(timestamp.nanos)}`.replace(/0+$/, '');
  return str.replace('000Z', `${nsStr}Z`);
}

/** Pad a number with 0 on the left */
function leftZeroPad(ns: number) {
  const str = `${ns}`;
  const pad = '000000000'.substring(0, 9 - str.length);
  return `${pad}${str}`;
}