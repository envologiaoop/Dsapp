import { describe, it, expect } from 'vitest';
import {
  sanitizeText,
  isValidEmail,
  isValidUsername,
  isValidObjectId,
  sanitizeContent,
  isValidPassword,
  isValidUrl,
  sanitizeFilename,
  sanitizeSearchQuery,
  getSignupValidationErrors,
  normalizeSignupInput,
  validateAvatarFile,
} from '../src/utils/validation';

describe('Input Validation and Sanitization', () => {
  describe('sanitizeText', () => {
    it('should escape HTML special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const output = sanitizeText(input);
      expect(output).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');
    });

    it('should escape single quotes', () => {
      expect(sanitizeText("it's a test")).toBe('it&#x27;s a test');
    });

    it('should trim whitespace', () => {
      expect(sanitizeText('  hello  ')).toBe('hello');
    });

    it('should return empty string for non-string input', () => {
      expect(sanitizeText(null as any)).toBe('');
      expect(sanitizeText(undefined as any)).toBe('');
      expect(sanitizeText(123 as any)).toBe('');
    });
  });

  describe('isValidEmail', () => {
    it('should accept valid email addresses', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('test.user+tag@domain.co.uk')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('user @domain.com')).toBe(false);
    });
  });

  describe('isValidUsername', () => {
    it('should accept valid usernames', () => {
      expect(isValidUsername('user123')).toBe(true);
      expect(isValidUsername('test_user')).toBe(true);
      expect(isValidUsername('user.name')).toBe(true);
    });

    it('should reject usernames that are too short', () => {
      expect(isValidUsername('ab')).toBe(false);
    });

    it('should reject usernames that are too long', () => {
      expect(isValidUsername('a'.repeat(21))).toBe(false);
    });

    it('should reject usernames with invalid characters', () => {
      expect(isValidUsername('user@name')).toBe(false);
      expect(isValidUsername('user name')).toBe(false);
      expect(isValidUsername('user!name')).toBe(false);
      expect(isValidUsername('user-name')).toBe(false);
      expect(isValidUsername('UserName')).toBe(false);
    });
  });

  describe('isValidObjectId', () => {
    it('should accept valid MongoDB ObjectIds', () => {
      expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
      expect(isValidObjectId('5f8d0d55b54764421b7156c9')).toBe(true);
    });

    it('should reject invalid ObjectIds', () => {
      expect(isValidObjectId('invalid')).toBe(false);
      expect(isValidObjectId('507f1f77bcf86cd79943901')).toBe(false); // Too short
      expect(isValidObjectId('507f1f77bcf86cd7994390111')).toBe(false); // Too long
      expect(isValidObjectId('507f1f77bcf86cd79943901g')).toBe(false); // Invalid hex
    });
  });

  describe('sanitizeContent', () => {
    it('should sanitize and limit content length', () => {
      const input = '<script>alert("test")</script>Some content';
      const output = sanitizeContent(input);
      expect(output).toContain('&lt;script&gt;');
      expect(output.length).toBeLessThanOrEqual(2000);
    });

    it('should enforce custom max length', () => {
      const input = 'a'.repeat(100);
      const output = sanitizeContent(input, 50);
      expect(output.length).toBe(50);
    });

    it('should handle empty strings', () => {
      expect(sanitizeContent('')).toBe('');
    });
  });

  describe('isValidPassword', () => {
    it('should accept strong passwords', () => {
      expect(isValidPassword('Password123')).toBe(true);
      expect(isValidPassword('MySecure1Pass')).toBe(true);
    });

    it('should reject passwords without uppercase', () => {
      expect(isValidPassword('password123')).toBe(false);
    });

    it('should reject passwords without lowercase', () => {
      expect(isValidPassword('PASSWORD123')).toBe(false);
    });

    it('should reject passwords without numbers', () => {
      expect(isValidPassword('PasswordTest')).toBe(false);
    });

    it('should reject passwords that are too short', () => {
      expect(isValidPassword('Pass1')).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    it('should accept valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://subdomain.example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com:8080/path?query=value')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false); // Missing protocol
      expect(isValidUrl('//example.com')).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove special characters', () => {
      expect(sanitizeFilename('file name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file@#$%.txt')).toBe('file____.txt');
    });

    it('should prevent directory traversal', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('_.__.__._etc_passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('_.__._windows_system32');
    });

    it('should limit filename length', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const sanitized = sanitizeFilename(longName);
      expect(sanitized.length).toBeLessThanOrEqual(255);
    });
  });

  describe('sanitizeSearchQuery', () => {
    it('should remove regex special characters', () => {
      const input = 'test.*query[a-z]+';
      const output = sanitizeSearchQuery(input);
      expect(output).toBe('testquerya-z');
    });

    it('should trim whitespace', () => {
      expect(sanitizeSearchQuery('  test query  ')).toBe('test query');
    });

    it('should enforce max length', () => {
      const longQuery = 'a'.repeat(200);
      const output = sanitizeSearchQuery(longQuery, 50);
      expect(output.length).toBe(50);
    });

    it('should handle empty strings', () => {
      expect(sanitizeSearchQuery('')).toBe('');
    });
  });

  describe('normalizeSignupInput', () => {
    it('normalizes email, username, and whitespace', () => {
      expect(
        normalizeSignupInput({
          name: '  Test   User ',
          username: ' Test_User ',
          email: ' USER@Example.com ',
          department: '  Software   Engineering ',
          year: ' 2 ',
        })
      ).toMatchObject({
        name: 'Test User',
        username: 'test_user',
        email: 'user@example.com',
        department: 'Software Engineering',
        year: '2',
      });
    });

    it('preserves password and confirmPassword values without overriding', () => {
      expect(
        normalizeSignupInput({
          password: 'Password123',
          confirmPassword: 'Password123',
        })
      ).toMatchObject({
        password: 'Password123',
        confirmPassword: 'Password123',
      });
    });
  });

  describe('getSignupValidationErrors', () => {
    it('returns no errors for a valid signup payload', () => {
      expect(
        getSignupValidationErrors({
          name: 'Test User',
          username: 'test_user',
          email: 'user@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          department: 'Software Engineering',
          year: '3',
        })
      ).toEqual([]);
    });

    it('reports invalid signup fields', () => {
      expect(
        getSignupValidationErrors({
          name: 'A',
          username: 'Bad Username',
          email: 'invalid',
          password: 'weak',
          confirmPassword: '',
          department: 'X',
          year: '9',
        })
      ).toEqual(
        expect.arrayContaining([
          'Full name must be at least 2 characters.',
          'Username must be 3-20 lowercase letters, numbers, underscores, or periods.',
          'Enter a valid email address.',
          'Password must be at least 8 characters and include uppercase, lowercase, and a number.',
          'Please confirm your password.',
          'Department must be at least 2 characters.',
          'Select a valid academic year.',
        ])
      );
    });

    it('reports password confirmation mismatch', () => {
      expect(
        getSignupValidationErrors({
          name: 'Test User',
          username: 'test_user',
          email: 'user@example.com',
          password: 'Password123',
          confirmPassword: 'Password124',
          department: 'Software Engineering',
          year: '3',
        })
      ).toContain('Password confirmation does not match.');
    });
  });

  describe('validateAvatarFile', () => {
    it('accepts supported avatars within the size limit', () => {
      expect(validateAvatarFile({ type: 'image/png', size: 1024 })).toBeNull();
    });

    it('rejects unsupported avatar file types', () => {
      expect(validateAvatarFile({ type: 'application/pdf', size: 1024 })).toBe(
        'Avatar must be a JPG, PNG, WebP, or GIF image.'
      );
    });

    it('rejects avatars that are too large', () => {
      expect(validateAvatarFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toBe(
        'Avatar must be 5MB or smaller.'
      );
    });
  });
});
