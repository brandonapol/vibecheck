import 'dart:convert';
import 'dart:io';

import 'package:dart_testast/extract.dart';

/// Reads a Dart test file on stdin and prints its tests and setup as JSON.
Future<void> main() async {
  final source = await utf8.decoder.bind(stdin).join();
  try {
    stdout.write(jsonEncode(extract(source)));
  } on FormatException catch (e) {
    stderr.writeln(e.message);
    exitCode = 1;
  }
}
