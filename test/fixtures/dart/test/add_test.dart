import 'package:test/test.dart';
import 'package:vibecheck_dart_fixture/add.dart';

void main() {
  test('adds', () {
    expect(add(2, 3), 5);
    expect(add(0, 0), 0);
    expect(add(-1, 1), 0);
  });
}
